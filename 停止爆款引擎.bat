@echo off
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue; if($c){ $c | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }; Write-Host 'Hit Engine stopped.' } else { Write-Host 'Server is not running.' }"
pause
