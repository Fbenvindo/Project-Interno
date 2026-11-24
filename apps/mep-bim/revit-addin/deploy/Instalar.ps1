# Instala o plugin SmartEasyBIM nas versões do Revit encontradas neste computador.
# Uso: clique duas vezes em Instalar.bat (não precisa de administrador).
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$addins = Join-Path $env:APPDATA "Autodesk\Revit\Addins"
$installed = @()
$skipped = @()

Get-ChildItem -Path $here -Directory | Where-Object { $_.Name -match '^20\d\d$' } | Sort-Object Name | ForEach-Object {
    $ver = $_.Name
    $revitDir = Join-Path $env:ProgramFiles "Autodesk\Revit $ver"
    $target = Join-Path $addins $ver
    if (-not (Test-Path $revitDir) -and -not (Test-Path $target)) { $skipped += $ver; return }
    $dest = Join-Path $target "SmartEasyBIM"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    Copy-Item -Force -Path (Join-Path $_.FullName "*") -Destination $dest
    Copy-Item -Force -Path (Join-Path $here "SmartEasyBIM.addin") -Destination $target
    # Arquivos baixados da internet ficam bloqueados pelo Windows e o Revit não os carrega.
    Get-ChildItem -Path $dest -Recurse | Unblock-File
    Unblock-File -Path (Join-Path $target "SmartEasyBIM.addin")
    $installed += $ver
}

Write-Host ""
if ($installed.Count -gt 0) {
    Write-Host "SmartEasyBIM instalado no Revit: $($installed -join ', ')" -ForegroundColor Green
    Write-Host "Abra (ou reabra) o Revit: a aba SmartEasyBIM aparece na faixa de opções."
} else {
    Write-Host "Nenhuma versão compatível do Revit (2022 a 2027) foi encontrada." -ForegroundColor Yellow
}
if ($skipped.Count -gt 0) { Write-Host "Sem Revit instalado: $($skipped -join ', ')" }
Write-Host ""
Read-Host "Pressione Enter para fechar"
