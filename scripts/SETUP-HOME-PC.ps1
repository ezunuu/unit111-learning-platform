param(
  [Parameter(Mandatory=$true)][string]$RepositoryUrl,
  [string]$Destination = 'C:\Dev\UNIT111-AVIATION-QUIZ'
)
$ErrorActionPreference = 'Stop'
if ($RepositoryUrl -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?$') { throw 'Use the verified HTTPS GitHub repository URL without embedded credentials.' }
if (Test-Path -LiteralPath $Destination) { throw 'Destination exists. Choose a new empty destination; this script never overwrites a project.' }
foreach ($tool in @('git','node','pnpm')) { if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool first." } }
if ((node --version) -notmatch '^v22\.') { throw 'Use Node 22.22.0 as specified by the project.' }
if ((pnpm --version).Trim() -ne '11.25.0') { throw 'Use pnpm 11.25.0 as specified by the lockfile.' }
& git clone -- $RepositoryUrl $Destination
if ($LASTEXITCODE -ne 0) { throw 'Clone failed. Complete GitHub authentication and retry with a new destination.' }
Push-Location $Destination
try {
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  if (Test-Path -LiteralPath '.env') { throw '.env already exists; refusing overwrite.' }
  function Read-PrivateValue([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    return [System.Net.NetworkCredential]::new('', $secure).Password
  }
  $runtimeUrl = Read-PrivateValue 'Paste approved DEVELOPMENT DATABASE_URL (hidden)'
  $directUrl = Read-PrivateValue 'Paste same database DIRECT_DATABASE_URL (hidden)'
  foreach ($connection in @($runtimeUrl,$directUrl)) {
    if ($connection -notmatch '^postgres(?:ql)?://[^\r\n]+$') { throw 'Expected a single-line PostgreSQL connection string.' }
  }
  $sessionSecret = (& node -e "console.log(require('crypto').randomBytes(32).toString('hex'))").Trim()
  $lines = @("DATABASE_URL=$runtimeUrl", "DIRECT_DATABASE_URL=$directUrl", "SESSION_SECRET=$sessionSecret", 'APP_ORIGIN=http://localhost:5173', 'API_PORT=4000', 'NODE_ENV=development')
  [System.IO.File]::WriteAllLines((Join-Path (Get-Location) '.env'), $lines, [System.Text.UTF8Encoding]::new($false))
  $runtimeUrl=$null; $directUrl=$null; $sessionSecret=$null; $lines=$null
  $env:UNIT111_TEST_DATABASE_INTEGRATION='0'
  foreach ($step in @('typecheck','test','build')) {
    & pnpm -r $step
    if ($LASTEXITCODE -ne 0) { throw "$step failed." }
  }
  Write-Host 'Setup complete. No migration, seed or restore was run. Start with: pnpm dev'
} finally { Pop-Location }
