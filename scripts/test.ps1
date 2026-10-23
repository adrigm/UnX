[CmdletBinding()]
param(
    [string]$GameDirectory,
    [string]$Python = 'python'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Install Visual Studio C++ desktop tools and a Windows 10/11 SDK.'
}
$vsPath = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsPath) { throw 'Visual Studio C++ x86/x64 tools were not found.' }
$devShell = Join-Path $vsPath 'Common7\Tools\Launch-VsDevShell.ps1'
& $devShell -Arch x86 -HostArch amd64 -SkipAutomaticLocation -NoLogo

$outputDirectory = Join-Path $repoRoot 'artifacts\tests'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
foreach ($name in @('signature_scan_test', 'game_memory_test')) {
    $source = Join-Path $repoRoot "tests\$name.cpp"
    $executable = Join-Path $outputDirectory "$name.exe"
    $object = Join-Path $outputDirectory "$name.obj"
    & cl /nologo /W4 /WX /EHsc /std:c++14 "/Fe:$executable" "/Fo:$object" $source
    if ($LASTEXITCODE -ne 0) { throw "Compiling $name failed." }
    & $executable
    if ($LASTEXITCODE -ne 0) { throw "$name failed." }
}

$verificationArguments = @((Join-Path $repoRoot 'scripts\verify_game_signatures.py'))
if ($GameDirectory) {
    $verificationArguments += (Resolve-Path -LiteralPath $GameDirectory).Path
}
& $Python @verificationArguments
if ($LASTEXITCODE -ne 0) { throw 'Offline game signature validation failed.' }
