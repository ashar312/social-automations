param(
    [Parameter(Mandatory, Position = 0)]
    [int]$Port
)

$process = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique

if (-not $process) {
    Write-Host "No process found on port $Port" -ForegroundColor Yellow
    exit 1
}

$name = (Get-Process -Id $process -ErrorAction SilentlyContinue).Name
Write-Host "Killing process $name (PID: $process) on port $Port..." -ForegroundColor Cyan
Stop-Process -Id $process -Force
Write-Host "Done." -ForegroundColor Green
