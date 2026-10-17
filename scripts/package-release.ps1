$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$outputDirectory = Join-Path $root 'artifacts'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$output = Join-Path $outputDirectory 'carnival-public.zip'

# Allowlist the release. Never archive the whole workspace or development screenshots.
$files = @(
  '.gitignore', 'package.json', 'package-lock.json', 'index.html', 'styles.css',
  'main.js', 'fullscreen.js', 'manifest.webmanifest', 'view.js', 'environment.js',
  'audio.js', 'server.js', 'launch.cjs',
  'assets/PROVENANCE.md', 'assets/audio/nai-dou-luo-battle.m4a',
  'assets/textures/factory-floor.webp', 'assets/textures/factory-panel.webp',
  'assets/entry/carnival-entry.webp'
) | ForEach-Object { Get-Item -LiteralPath (Join-Path $root $_) }
$files += Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Extension -in @('.md', '.cmd') }
foreach ($directory in @('shared', 'test', 'scripts')) {
  $files += Get-ChildItem -LiteralPath (Join-Path $root $directory) -File -Recurse
}
foreach ($file in $files) {
  if (-not $file.FullName.StartsWith($root + [IO.Path]::DirectorySeparatorChar)) { throw 'Release path outside workspace' }
  if ($file.Extension -in @('.js', '.cjs', '.json', '.html', '.css', '.md', '.ps1')) {
    $text = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    if ($text -match 'sk-[A-Za-z0-9]{20,}') { throw "Possible credential in $($file.Name)" }
  }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output }
$zip = [IO.Compression.ZipFile]::Open($output, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $relative = $file.FullName.Substring($root.Length + 1).Replace('\', '/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }
Get-Item -LiteralPath $output | Select-Object Name, Length
