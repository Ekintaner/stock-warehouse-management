$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root ".env"
$ignorePath = Join-Path $root ".gitignore"

if (-not (Test-Path $ignorePath)) {
    throw "The workspace .gitignore file is missing; no environment file was changed."
}

$ignoreRules = Get-Content -LiteralPath $ignorePath
if (($ignoreRules -notcontains ".env") -or ($ignoreRules -notcontains ".env.*")) {
    throw "The workspace ignore rules do not protect .env; no environment file was changed."
}

if (-not (Test-Path $envPath)) {
    Copy-Item -LiteralPath (Join-Path $root ".env.example") -Destination $envPath
}

function Read-LocalRolePassword([string]$roleName) {
    $securePassword = Read-Host "Enter the local $roleName password (input is hidden)" -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    try {
        $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        $securePassword.Dispose()
    }
    if ([string]::IsNullOrEmpty($password)) {
        throw "A non-empty local role password is required."
    }
    return $password
}

$appPassword = Read-LocalRolePassword "stock_warehouse_app"
$migrationPassword = Read-LocalRolePassword "stock_warehouse_migrator"
$encodedAppPassword = [Uri]::EscapeDataString($appPassword)
$encodedMigrationPassword = [Uri]::EscapeDataString($migrationPassword)

$databaseKeys = '^(DATABASE_URL|MIGRATION_DATABASE_URL|TEST_DATABASE_URL|TEST_MIGRATION_DATABASE_URL)='
$lines = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -notmatch $databaseKeys })
$lines += "DATABASE_URL=postgresql://stock_warehouse_app:$encodedAppPassword@127.0.0.1:5432/stock_warehouse_local?schema=public"
$lines += "MIGRATION_DATABASE_URL=postgresql://stock_warehouse_migrator:$encodedMigrationPassword@127.0.0.1:5432/stock_warehouse_local?schema=public"
$lines += "TEST_DATABASE_URL=postgresql://stock_warehouse_app:$encodedAppPassword@127.0.0.1:5432/stock_warehouse_test?schema=public"
$lines += "TEST_MIGRATION_DATABASE_URL=postgresql://stock_warehouse_migrator:$encodedMigrationPassword@127.0.0.1:5432/stock_warehouse_test?schema=public"

try {
    [System.IO.File]::WriteAllLines(
        $envPath,
        $lines,
        [System.Text.UTF8Encoding]::new($false)
    )
    Write-Output "Local database URLs were saved to the ignored .env file. Passwords were not displayed."
}
catch {
    throw "Could not save the local database URLs. Passwords were not displayed."
}
finally {
    $appPassword = $null
    $migrationPassword = $null
    $encodedAppPassword = $null
    $encodedMigrationPassword = $null
    $lines = $null
}
