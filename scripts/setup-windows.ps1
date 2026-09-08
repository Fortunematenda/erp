$ErrorActionPreference = "Stop"
Write-Host "";
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " NexusERP Cloud - Native Windows Setup" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name is not installed or is not in PATH. See docs/INSTALLATION-WINDOWS.md"
  }
}

Require-Command node
Require-Command npm
Write-Host "Node: $(node -v)" -ForegroundColor Green
Write-Host "npm : $(npm -v)" -ForegroundColor Green

if (-not (Test-Path "apps/api/.env")) {
  $dbHost = Read-Host "PostgreSQL host [localhost]"; if ([string]::IsNullOrWhiteSpace($dbHost)) { $dbHost = "localhost" }
  $dbPort = Read-Host "PostgreSQL port [5432]"; if ([string]::IsNullOrWhiteSpace($dbPort)) { $dbPort = "5432" }
  $dbName = Read-Host "Database name [nexuserp]"; if ([string]::IsNullOrWhiteSpace($dbName)) { $dbName = "nexuserp" }
  $dbUser = Read-Host "Database user [postgres]"; if ([string]::IsNullOrWhiteSpace($dbUser)) { $dbUser = "postgres" }
  $secure = Read-Host "Database password" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { $dbPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $encodedPassword = [System.Uri]::EscapeDataString($dbPassword)
  $jwt = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
  @"
DATABASE_URL="postgresql://${dbUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}?schema=public"
PORT=4000
WEB_ORIGIN="http://localhost:3000"
JWT_SECRET="$jwt"
JWT_EXPIRES_IN="8h"
ZIMRA_MODE="mock"
ZIMRA_TEST_BASE_URL=""
ZIMRA_PRODUCTION_BASE_URL=""
"@ | Set-Content "apps/api/.env" -Encoding UTF8
  Write-Host "Created apps/api/.env" -ForegroundColor Green
} else {
  Write-Host "Using existing apps/api/.env" -ForegroundColor Yellow
}

if (-not (Test-Path "apps/web/.env.local")) { Copy-Item "apps/web/.env.local.example" "apps/web/.env.local" }

Write-Host "Installing packages..." -ForegroundColor Cyan
npm install
Write-Host "Generating Prisma client..." -ForegroundColor Cyan
npm run db:generate
Write-Host "Creating/updating database schema..." -ForegroundColor Cyan
npm run db:push
Write-Host "Loading demo data..." -ForegroundColor Cyan
npm run db:seed

Write-Host "";
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Run: npm run dev" -ForegroundColor White
Write-Host "ERP: http://localhost:3000" -ForegroundColor White
Write-Host "API docs: http://localhost:4000/docs" -ForegroundColor White
