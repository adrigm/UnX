'use strict';

// Change only the requested values. Existing comments, ordering, unknown keys,
// newline convention, BOM and UTF-16 byte order remain intact.
function decode(buffer) {
  if (!buffer) return { text: '', encoding: 'utf8', bom: false };
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf16le', bom: true };
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const bytes = Buffer.from(buffer.subarray(2));
    if (bytes.length % 2) throw new Error('The UTF-16 configuration has an incomplete character.');
    bytes.swap16();
    return { text: bytes.toString('utf16le'), encoding: 'utf16be', bom: true };
  }
  const bom = buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const bytes = bom ? buffer.subarray(3) : buffer;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf8', bom };
  } catch {
    // Preserve legacy single-byte INIs byte-for-byte outside changed values.
    return { text: bytes.toString('latin1'), encoding: 'latin1', bom: false };
  }
}

function encode(document) {
  const { text, encoding, bom } = document;
  if (encoding === 'utf16be') {
    const bytes = Buffer.from(text, 'utf16le');
    bytes.swap16();
    return Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]);
  }
  const bytes = Buffer.from(text, encoding);
  if (!bom) return bytes;
  return Buffer.concat([encoding === 'utf16le' ? Buffer.from([0xff, 0xfe]) : Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
}

function sectionName(line) {
  const match = /^\s*\[([^\]]+)\]/.exec(line);
  return match ? match[1].trim() : null;
}

function valueParts(value) {
  let quote = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if ((character === '"' || character === "'") && value[index - 1] !== '\\') {
      if (quote === character) quote = null;
      else if (!quote) quote = character;
    }
    if (!quote && (character === ';' || character === '#') && index > 0 && /[ \t]/.test(value[index - 1])) {
      const prefix = value.slice(0, index);
      const whitespace = /[ \t]*$/.exec(prefix)[0];
      return { value: prefix.trim(), comment: whitespace + value.slice(index) };
    }
  }
  return { value: value.trim(), comment: '' };
}

function parse(buffer) {
  const document = decode(buffer);
  const newline = document.text.includes('\r\n') ? '\r\n' : '\n';
  const lines = document.text.split(/\r?\n/);
  const values = new Map();
  let section = '';
  for (const line of lines) {
    const header = sectionName(line);
    if (header !== null) { section = header.toLowerCase(); continue; }
    const match = /^(\s*)([^;#=\s][^=]*?)(\s*=\s*)(.*)$/.exec(line);
    if (match) values.set(`${section}\0${match[2].trim().toLowerCase()}`, valueParts(match[4]).value);
  }
  return { ...document, newline, lines, values };
}

function get(document, section, key) {
  return document.values.get(`${section.toLowerCase()}\0${key.toLowerCase()}`);
}

function edit(buffer, changes) {
  const document = parse(buffer);
  const lines = [...document.lines];
  for (const { section, key, value } of changes) {
    if (/[\r\n\0]/.test(String(value)) || /[\r\n\]\0]/.test(section) || /[\r\n=\0]/.test(key)) {
      throw new Error('Configuration values cannot contain line breaks.');
    }
    const sectionLower = section.toLowerCase();
    const keyLower = key.toLowerCase();
    let current = '';
    let lastHeader = -1;
    let sectionEnd = lines.length;
    const matches = [];
    for (let index = 0; index < lines.length; index++) {
      const header = sectionName(lines[index]);
      if (header !== null) {
        if (current === sectionLower) sectionEnd = index;
        current = header.toLowerCase();
        if (current === sectionLower) { lastHeader = index; sectionEnd = lines.length; }
        continue;
      }
      const match = /^(\s*)([^;#=\s][^=]*?)(\s*=\s*)(.*)$/.exec(lines[index]);
      if (current === sectionLower && match && match[2].trim().toLowerCase() === keyLower) {
        matches.push({ index, prefix: `${match[1]}${match[2]}${match[3]}`, comment: valueParts(match[4]).comment });
      }
    }
    if (matches.length) {
      // Update duplicate entries too, so first-key and last-key readers agree.
      for (const match of matches) lines[match.index] = `${match.prefix}${value}${match.comment}`;
    } else if (lastHeader !== -1) {
      while (sectionEnd > lastHeader + 1 && lines[sectionEnd - 1] === '') sectionEnd--;
      lines.splice(sectionEnd, 0, `${key}=${value}`);
    } else {
      if (lines.length === 1 && !lines[0]) lines.length = 0;
      if (lines.length && lines[lines.length - 1] !== '') lines.push('');
      lines.push(`[${section}]`, `${key}=${value}`);
    }
  }
  document.text = lines.join(document.newline);
  if (document.text && !document.text.endsWith(document.newline)) document.text += document.newline;
  return encode(document);
}

function remove(buffer, keys) {
  const document = parse(buffer);
  const targets = new Set(keys.map(({ section, key }) => `${section.toLowerCase()}\0${key.toLowerCase()}`));
  let section = '';
  const lines = document.lines.filter(line => {
    const header = sectionName(line);
    if (header !== null) { section = header.toLowerCase(); return true; }
    const match = /^(\s*)([^;#=\s][^=]*?)(\s*=\s*)(.*)$/.exec(line);
    return !match || !targets.has(`${section}\0${match[2].trim().toLowerCase()}`);
  });
  document.text = lines.join(document.newline);
  return encode(document);
}

module.exports = { decode, encode, parse, get, edit, remove };
