# App compilado rodando sozinho no Windows, sem janela, pela tarefa agendada "sis-financas" (inicia no logon).
# Use pelos comandos npm run app:instalar | app:iniciar | app:parar | app:reiniciar | app:remover
# (sem acentos de proposito: o PowerShell 5.1 le errado um .ps1 em UTF-8 sem BOM)
param([Parameter(Mandatory)][ValidateSet('instalar', 'iniciar', 'parar', 'reiniciar', 'remover')][string]$acao)
$ErrorActionPreference = 'Stop'
$tarefa = 'sis-financas'

function Install-App {
  $node = 'C:\nvm4w\nodejs\node.exe' # atalho do nvm: acompanha a versao ativa
  if (-not (Test-Path $node)) { $node = (Get-Command node).Source }
  if ("$node$PSScriptRoot" -match '\s') { throw "Caminho com espaco nao funciona na linha do cmd: $node / $PSScriptRoot" }
  $usuario = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  # conhost --headless: sem janela. O log recomeca a cada inicio, para nao crescer sem fim.
  $comando = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" -WorkingDirectory $PSScriptRoot `
    -Argument "--headless cmd /d /c $node $PSScriptRoot\api\dist\server.js > data\app.log 2>&1"
  # o padrao do Windows so inicia na tomada, para na bateria e mata a tarefa depois de 3 dias.
  # Restart: cobre o D: (Dev Drive, disco virtual) ainda nao montado no logon; nao reinicia servidor que caiu.
  $ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  Register-ScheduledTask -TaskName $tarefa -Action $comando -Settings $ajustes -Force `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $usuario) `
    -Principal (New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited) `
    -Description 'Sobe o sis-financas (tela e API em http://127.0.0.1:3333) no logon.' | Out-Null
  'Registrada. Inicia no proximo logon; para iniciar agora: npm run app:iniciar'
}

# Parar a tarefa mata so o conhost; o node continuaria vivo, segurando a porta.
function Stop-App {
  if (Get-ScheduledTask $tarefa -ErrorAction SilentlyContinue) { Stop-ScheduledTask $tarefa }
  $servidor = [regex]::Escape("$PSScriptRoot\api\dist\server.js")
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object CommandLine -match $servidor |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  'Parado.'
}

function Start-App {
  if (-not (Test-Path "$PSScriptRoot\api\dist\server.js")) { throw 'Rode npm run build antes.' }
  Start-ScheduledTask $tarefa
  $porta = 3333 # ponytail: se um dia mudar PORT no .env, mude aqui (e no MCP do Claude Desktop)
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if ((Get-ScheduledTask $tarefa).State -ne 'Running') { break } # caiu ao subir (porta ocupada, por exemplo)
    try { Invoke-RestMethod "http://127.0.0.1:$porta/api/saude" -TimeoutSec 2 | Out-Null; return "No ar: http://127.0.0.1:$porta" } catch { }
  }
  throw 'Nao subiu. Veja data\app.log (porta ocupada por um npm run dev?).'
}

switch ($acao) {
  'instalar' { Install-App }
  'iniciar' { Start-App }
  'parar' { Stop-App }
  'reiniciar' { Stop-App; Start-Sleep 1; Start-App }
  'remover' { Stop-App; Unregister-ScheduledTask $tarefa -Confirm:$false; 'Removida.' }
}
