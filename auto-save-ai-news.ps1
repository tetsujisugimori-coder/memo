param(
  [Parameter(Mandatory=$true)]
  [string]$SourceFile,
  [string]$ImportDir = (Join-Path $PSScriptRoot 'IMPORT')
)

if (-not (Test-Path $SourceFile)) {
  Write-Error "Source file not found: $SourceFile"
  exit 1
}

if (-not (Test-Path $ImportDir)) {
  New-Item -Path $ImportDir -ItemType Directory -Force | Out-Null
}

# Output paths
$date = (Get-Date).ToString('yyyy-MM-dd')
$out1 = Join-Path $ImportDir "ai-news-$date.json"
$outLatest = Join-Path $ImportDir 'ai-news-latest.json'

# Locate build script
$buildScript = Join-Path $PSScriptRoot 'build-ai-news-json.js'
if (-not (Test-Path $buildScript)) {
  Write-Error "build-ai-news-json.js not found in $PSScriptRoot"
  exit 2
}

# Run Node to build JSON
Write-Output "Running: node $buildScript $SourceFile $out1"
& node $buildScript $SourceFile $out1
$rc = $LASTEXITCODE
if ($rc -ne 0) {
  Write-Error "build-ai-news-json.js failed with exit code $rc"
  exit $rc
}

# Update latest file
Copy-Item -Path $out1 -Destination $outLatest -Force

Write-Output "Wrote: $out1"
Write-Output "Updated: $outLatest"
exit 0
