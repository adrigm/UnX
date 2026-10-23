[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SpecialKDll,
    [ValidateSet('Release', 'Debug')]
    [string]$Configuration = 'Release',
    [string]$PlatformToolset
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$specialKPath = (Resolve-Path -LiteralPath $SpecialKDll).Path
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Install Visual Studio C++ desktop tools, including ATL and a Windows 10/11 SDK.'
}
$vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw 'Visual Studio C++ x86/x64 tools were not found.' }
$msbuild = Join-Path $vsPath 'MSBuild\Current\Bin\MSBuild.exe'
$vcTools = Get-ChildItem (Join-Path $vsPath 'VC\Tools\MSVC') -Directory |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
$lib = Join-Path $vcTools.FullName 'bin\Hostx64\x86\lib.exe'
$dumpbin = Join-Path $vcTools.FullName 'bin\Hostx64\x86\dumpbin.exe'
if (-not $PlatformToolset) {
    $PlatformToolset = Get-ChildItem (Join-Path $vsPath 'MSBuild\Microsoft\VC\v*\Platforms\Win32\PlatformToolsets\*') -Directory |
        Where-Object { $_.Name -match '^v\d+$' } |
        Sort-Object { [int]$_.Name.Substring(1) } -Descending |
        Select-Object -First 1 -ExpandProperty Name
}
if (-not $PlatformToolset) { throw 'A Win32 Visual C++ platform toolset was not found.' }

# Check the input binary without loading it. System32\dxgi.dll is not Special K.
$peBytes = [System.IO.File]::ReadAllBytes($specialKPath)
$peOffset = [BitConverter]::ToInt32($peBytes, 0x3c)
if ([BitConverter]::ToUInt32($peBytes, $peOffset) -ne 0x4550 -or
    [BitConverter]::ToUInt16($peBytes, $peOffset + 4) -ne 0x14c) {
    throw 'SpecialKDll must be the 32-bit Special K dxgi.dll supplied with UnX.'
}
$sectionCount = [BitConverter]::ToUInt16($peBytes, $peOffset + 6)
$optionalHeaderSize = [BitConverter]::ToUInt16($peBytes, $peOffset + 20)
$sectionTable = $peOffset + 24 + $optionalHeaderSize
$sections = for ($i = 0; $i -lt $sectionCount; ++$i) {
    $section = $sectionTable + 40 * $i
    [pscustomobject]@{
        Start = [BitConverter]::ToUInt32($peBytes, $section + 12)
        Size = [Math]::Max([BitConverter]::ToUInt32($peBytes, $section + 8), [BitConverter]::ToUInt32($peBytes, $section + 16))
        Executable = ([BitConverter]::ToUInt32($peBytes, $section + 36) -band 0x20000000) -ne 0
    }
}
$exportListing = & $dumpbin /nologo /exports $specialKPath
if ($LASTEXITCODE -ne 0) { throw 'dumpbin could not read the Special K exports.' }
$exports = foreach ($line in $exportListing) {
    if ($line -match '^\s+(\d+)\s+[0-9A-Fa-f]+\s+([0-9A-Fa-f]{8})\s+(\S+)') {
        $rva = [Convert]::ToUInt32($Matches[2], 16)
        $exportSection = $sections | Where-Object { $rva -ge $_.Start -and $rva -lt ($_.Start + $_.Size) } | Select-Object -First 1
        [pscustomobject]@{ Ordinal = $Matches[1]; Name = $Matches[3]; Data = $exportSection -and -not $exportSection.Executable }
    }
}
if ($exports.Name -notcontains '?SK_ImGui_Visible@@3_NA' -or
    $exports.Name -notcontains '?InputFloat@ImGui@@YA_NPBDPAMMMHH@Z') {
    throw 'This DLL does not export the legacy Special K/ImGui 1.50 API required by UnX.'
}

$depsPath = Join-Path $repoRoot 'artifacts\deps'
New-Item -ItemType Directory -Path $depsPath -Force | Out-Null
$defPath = Join-Path $depsPath 'dxgi.def'
$defLines = @('LIBRARY dxgi.dll', 'EXPORTS')
$defLines += $exports | ForEach-Object {
    $dataSuffix = if ($_.Data) { ' DATA' } else { '' }
    '  {0} @{1}{2}' -f $_.Name, $_.Ordinal, $dataSuffix
}
[System.IO.File]::WriteAllLines($defPath, [string[]]$defLines, [System.Text.Encoding]::ASCII)
& $lib /nologo /machine:x86 "/def:$defPath" "/out:$(Join-Path $depsPath 'dxgi.lib')"
if ($LASTEXITCODE -ne 0) { throw 'Generating the Special K import library failed.' }

& $msbuild (Join-Path $repoRoot 'UnX\UnX.vcxproj') /m /nologo /verbosity:minimal /target:Build "/p:Configuration=$Configuration" /p:Platform=Win32 "/p:PlatformToolset=$PlatformToolset" /p:WindowsTargetPlatformVersion=10.0
if ($LASTEXITCODE -ne 0) { throw 'UnX compilation failed.' }

$outputDll = Join-Path $repoRoot "artifacts\Win32\$Configuration\unx.dll"
$imports = & $dumpbin /nologo /imports $outputDll
if ($LASTEXITCODE -ne 0) { throw 'Validating the resulting DLL failed.' }
$inSpecialKImports = $false
$missing = @(foreach ($line in $imports) {
    if ($line -match '^\s+(\S+\.dll)\s*$') {
        $inSpecialKImports = $Matches[1] -eq 'dxgi.dll'
    }
    elseif ($inSpecialKImports -and $line -match '^\s+[0-9A-Fa-f]+\s+(\S+)\s*$' -and $Matches[1] -notin $exports.Name) {
        $Matches[1]
    }
})
if ($missing.Count) { throw "The built DLL imports symbols absent from Special K: $($missing -join ', ')" }
Write-Host "Built $outputDll"
Write-Host "Special K SHA256: $((Get-FileHash -LiteralPath $specialKPath -Algorithm SHA256).Hash)"
