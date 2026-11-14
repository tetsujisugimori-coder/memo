# PowerShell 7. Never installs software or changes service/configuration.
param(
  [ValidateSet('plan','probe','run')][string]$Mode = 'plan',
  [string]$Model,
  [string]$OutputDirectory,
  [switch]$Execute
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 required' }
$Script = Join-Path $PSScriptRoot 'ai-stage1-validation.cjs'
if ($Mode -eq 'run') {
  if (-not $Execute) { throw 'Explicit -Execute is required; no inference started' }
  if (-not $Model -or -not $OutputDirectory) { throw 'Model and OutputDirectory required' }
  if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) { throw 'Choose an existing dedicated output directory' }
  & node $Script run --model $Model --output $OutputDirectory --execute
} else { & node $Script $Mode }
if ($LASTEXITCODE -ne 0) { throw "Validation exit code: $LASTEXITCODE" }
