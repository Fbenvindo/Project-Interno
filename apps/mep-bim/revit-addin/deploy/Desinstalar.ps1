# Remove o plugin SmartEasyBIM de todas as versões do Revit.
$addins = Join-Path $env:APPDATA "Autodesk\Revit\Addins"
$removed = @()
Get-ChildItem -Path $addins -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $manifest = Join-Path $_.FullName "SmartEasyBIM.addin"
    $folder = Join-Path $_.FullName "SmartEasyBIM"
    if (Test-Path $manifest) { Remove-Item -Force $manifest; $removed += $_.Name }
    if (Test-Path $folder) { Remove-Item -Recurse -Force $folder }
}
if ($removed.Count -gt 0) { Write-Host "SmartEasyBIM removido do Revit: $($removed -join ', ')" }
else { Write-Host "O plugin não estava instalado." }
Read-Host "Pressione Enter para fechar"
