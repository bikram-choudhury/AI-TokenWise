$ErrorActionPreference = "SilentlyContinue"

function Get-SourceDetails {
  param(
    [string]$Provider,
    [string]$Label,
    [string]$PathValue,
    [bool]$Enabled
  )

  $exists = Test-Path $PathValue
  $kind = "missing"
  $count = 0
  $sample = @()
  $notes = ""

  if ($exists) {
    $item = Get-Item $PathValue
    if ($item.PSIsContainer) {
      $kind = "directory"

      switch ($Provider) {
        "vscode" {
          $files = Get-ChildItem $PathValue -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "chatSessions|emptyWindowChatSessions" }
          $count = @($files).Count
          $sample = @($files | Select-Object -First 5 -ExpandProperty FullName)
          $notes = "Looking for VSCode Copilot chat session JSONL files"
        }
        "claude" {
          $files = Get-ChildItem $PathValue -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue
          $count = @($files).Count
          $sample = @($files | Select-Object -First 5 -ExpandProperty FullName)
          $notes = "Looking for Claude Code transcript JSONL files"
        }
        "openai" {
          $files = Get-ChildItem $PathValue -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue
          $count = @($files).Count
          $sample = @($files | Select-Object -First 5 -ExpandProperty FullName)
          $notes = "Looking for OpenAI/Codex session JSONL files"
        }
        default {
          $files = Get-ChildItem $PathValue -Recurse -File -ErrorAction SilentlyContinue
          $count = @($files).Count
          $sample = @($files | Select-Object -First 5 -ExpandProperty FullName)
          $notes = "Generic directory scan"
        }
      }
    }
    else {
      $kind = "file"
      $count = 1
      $sample = @($item.FullName)

      if ($Provider -eq "cli") {
        $notes = "Expected copilot-cli SQLite database"
      }
      else {
        $notes = "Single file source"
      }
    }
  }

  [pscustomobject]@{
    Provider   = $Provider
    Label      = $Label
    Enabled    = $Enabled
    Exists     = $exists
    Kind       = $kind
    Path       = $PathValue
    MatchCount = $count
    Notes      = $notes
    Sample     = if ($sample.Count -gt 0) { $sample -join "`n" } else { "" }
  }
}

$settingsPath = Join-Path $HOME ".tokenwise\settings.json"

if (Test-Path $settingsPath) {
  Write-Host ""
  Write-Host "TokenWise configured sources" -ForegroundColor Cyan
  Write-Host "Settings file: $settingsPath" -ForegroundColor DarkGray
  Write-Host ""

  $settings = Get-Content $settingsPath -Raw | ConvertFrom-Json
  $results = foreach ($src in $settings.sources) {
    Get-SourceDetails -Provider $src.provider -Label $src.label -PathValue $src.path -Enabled $src.enabled
  }

  $results | Select-Object Provider, Label, Enabled, Exists, Kind, MatchCount, Path |
    Format-Table -Wrap -AutoSize

  Write-Host ""
  Write-Host "Sample matches" -ForegroundColor Cyan
  foreach ($row in $results) {
    Write-Host ""
    Write-Host ("[{0}] {1}" -f $row.Provider, $row.Label) -ForegroundColor Yellow
    if ([string]::IsNullOrWhiteSpace($row.Sample)) {
      Write-Host "  No matching files found"
    }
    else {
      $row.Sample -split "`n" | ForEach-Object { Write-Host "  $_" }
    }
  }
}
else {
  Write-Host ""
  Write-Host "No TokenWise settings file found. Falling back to default locations." -ForegroundColor Yellow
  Write-Host ""

  $defaults = @(
    [pscustomobject]@{ provider = "cli";    label = "copilot-cli default";        path = "$HOME\.copilot\session-store.db"; enabled = $true }
    [pscustomobject]@{ provider = "vscode"; label = "VSCode workspace storage";   path = (Join-Path $env:APPDATA "Code\User\workspaceStorage"); enabled = $true }
    [pscustomobject]@{ provider = "vscode"; label = "VSCode global storage";      path = (Join-Path $env:APPDATA "Code\User\globalStorage"); enabled = $true }
    [pscustomobject]@{ provider = "claude"; label = "Claude Code default";        path = "$HOME\.claude\projects"; enabled = $true }
    [pscustomobject]@{ provider = "openai"; label = "OpenAI Codex default";       path = "$HOME\.codex\sessions"; enabled = $true }
  )

  $results = foreach ($src in $defaults) {
    Get-SourceDetails -Provider $src.provider -Label $src.label -PathValue $src.path -Enabled $src.enabled
  }

  $results | Select-Object Provider, Label, Enabled, Exists, Kind, MatchCount, Path |
    Format-Table -Wrap -AutoSize
}