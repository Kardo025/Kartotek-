# Kartotek build script
#  - Inlines src\ (index.html + styles.css + ui.css + scripts + ui.js) into one self-contained HTML file
#    ui.js / ui.css are the React interface, built from ui\ with:  cd ui; npm install; npm run build  (then copy dist\ui.* to src\)
#  - Embeds every studies\<name>\etut.json into the page (the Study tab imports them on first open)
#  - Embeds every studies\<name>\extras\*.json (Study v2: explanations and follow-up items from Claude Code)
#  - Embeds every lessons\<name>\lesson.json the same way (End-of-Lesson Test tab)
#  - Embeds every mocks\<name>\mock.json the same way (Mock exam tab of the exam sections)
#  - Embeds every mindmaps\<id>\ map.json + turns\*.json + grades\*.json + reference.json (Mind maps, MINDMAP-RULES.md); photos stay in views\
#  - Prints every studies\<name>\note-sheet.html to PDF with headless Microsoft Edge
#  - Content comes from the content folder: -Content <path>, else the KARTOTEK_CONTENT environment variable, else
#    "contentDir" in kartotek.config.json (git-ignored, see kartotek.config.example.json), else the synthetic samples in samples\.
#    The content folder holds studies\, lessons\, mocks\, mindmaps\, exam\ (tud-apply.json), sources\ and notes\.
# Usage:  powershell -ExecutionPolicy Bypass -File build.ps1 [-SkipPdf] [-Only <study-folder-name>] [-Content <path>]
param(
  [switch]$SkipPdf,
  [string]$Only = '',
  [string]$Content = ''
)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$src = Join-Path $root 'src'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Read-Utf8([string]$path) { return [IO.File]::ReadAllText($path, $utf8) }

# ---------------------------------------------------------------- content folder
$contentDir = $Content
if (-not $contentDir) { $contentDir = $env:KARTOTEK_CONTENT }
if (-not $contentDir) {
  $cfgPath = Join-Path $root 'kartotek.config.json'
  if (Test-Path $cfgPath) { $contentDir = (Read-Utf8 $cfgPath | ConvertFrom-Json).contentDir }
}
if ($contentDir) {
  $contentDir = [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($contentDir))
  if (-not (Test-Path $contentDir)) { throw "Content folder not found: $contentDir" }
  $contentRoot = $contentDir
  Write-Host "  content: $contentDir"
} else {
  $contentRoot = Join-Path $root 'samples'
  Write-Host '  content: samples\ (no content folder configured)'
}

# ---------------------------------------------------------------- study packages
$etutDirs = @(Get-ChildItem (Join-Path $contentRoot 'studies') -Directory -ErrorAction SilentlyContinue)
$packages = @()
foreach ($d in $etutDirs) {
  $jsonPath = Join-Path $d.FullName 'etut.json'
  if (-not (Test-Path $jsonPath)) { continue }
  $raw = Read-Utf8 $jsonPath
  try { $obj = $raw | ConvertFrom-Json } catch { throw "Invalid JSON: $jsonPath -- $($_.Exception.Message)" }
  if (-not $obj.etut_id) { throw "etut_id missing: $jsonPath" }
  $packages += $raw.Trim().Replace('</', '<\/')
  Write-Host ("  study: {0} ({1} parts)" -f $obj.etut_id, @($obj.parts).Count)
}
$cfgJson = (@{ contentDir = $contentDir } | ConvertTo-Json -Compress).Replace('</', '<\/')
$bundled = '<script type="application/json" id="kartotek-config">' + $cfgJson + '</script>' + "`n"
$examPath = Join-Path $contentRoot 'exam\tud-apply.json'
$exam = 'null'
if (Test-Path $examPath) { $raw = Read-Utf8 $examPath; try { $null = $raw | ConvertFrom-Json } catch { throw "Invalid JSON: $examPath -- $($_.Exception.Message)" }; $exam = $raw.Trim().Replace('</', '<\/'); Write-Host '  exam plan: tud-apply.json' }
$bundled += '<script type="application/json" id="bundled-exam">' + $exam + '</script>' + "`n"
$bundled += '<script type="application/json" id="bundled-etuts">[' + ($packages -join ',') + ']</script>'

# ---------------------------------------------------------------- study extras (Study v2: Explain texts and follow-up items written by Claude Code, STUDY-RULES.md "Study v2")
$extras = @()
foreach ($d in $etutDirs) {
  $xdir = Join-Path $d.FullName 'extras'
  if (-not (Test-Path $xdir)) { continue }
  foreach ($f in @(Get-ChildItem $xdir -Filter '*.json' | Sort-Object Name)) {
    $raw = Read-Utf8 $f.FullName
    try { $null = $raw | ConvertFrom-Json } catch { throw "Invalid JSON: $($f.FullName) -- $($_.Exception.Message)" }
    $extras += $raw.Trim().Replace('</', '<\/')
  }
}
if ($extras.Count) { Write-Host ("  study extras: {0}" -f $extras.Count) }
$bundled += "`n" + '<script type="application/json" id="bundled-study-extras">[' + ($extras -join ',') + ']</script>'

# ---------------------------------------------------------------- end-of-lesson test packages
$lessonDirs = @(Get-ChildItem (Join-Path $contentRoot 'lessons') -Directory -ErrorAction SilentlyContinue)
$lessons = @()
foreach ($d in $lessonDirs) {
  $jsonPath = Join-Path $d.FullName 'lesson.json'
  if (-not (Test-Path $jsonPath)) { continue }
  $raw = Read-Utf8 $jsonPath
  try { $obj = $raw | ConvertFrom-Json } catch { throw "Invalid JSON: $jsonPath -- $($_.Exception.Message)" }
  if (-not $obj.lesson_id) { throw "lesson_id missing: $jsonPath" }
  $lessons += $raw.Trim().Replace('</', '<\/')
  Write-Host ("  lesson: {0} ({1} parts)" -f $obj.lesson_id, @($obj.parts).Count)
}
$bundled += "`n" + '<script type="application/json" id="bundled-lessons">[' + ($lessons -join ',') + ']</script>'

# ---------------------------------------------------------------- mock exam packages (MOCK-RULES.md)
$mockDirs = @(Get-ChildItem (Join-Path $contentRoot 'mocks') -Directory -ErrorAction SilentlyContinue)
$mocks = @()
foreach ($d in $mockDirs) {
  $jsonPath = Join-Path $d.FullName 'mock.json'
  if (-not (Test-Path $jsonPath)) { continue }
  $raw = Read-Utf8 $jsonPath
  try { $obj = $raw | ConvertFrom-Json } catch { throw "Invalid JSON: $jsonPath -- $($_.Exception.Message)" }
  if (-not $obj.mock_id) { throw "mock_id missing: $jsonPath" }
  $mocks += $raw.Trim().Replace('</', '<\/')
  Write-Host ("  mock: {0} ({1} sections)" -f $obj.mock_id, @($obj.sections).Count)
}
$bundled += "`n" + '<script type="application/json" id="bundled-mocks">[' + ($mocks -join ',') + ']</script>'

# ---------------------------------------------------------------- mind maps (MINDMAP-RULES.md); photos are not embedded
function Read-JsonRaw([string]$path) {
  $raw = Read-Utf8 $path
  try { $null = $raw | ConvertFrom-Json } catch { throw "Invalid JSON: $path -- $($_.Exception.Message)" }
  return $raw.Trim().Replace('</', '<\/')
}
$mindDirs = @(Get-ChildItem (Join-Path $contentRoot 'mindmaps') -Directory -ErrorAction SilentlyContinue)
$minds = @()
foreach ($d in $mindDirs) {
  if ($d.Name -notmatch '^[a-z0-9][a-z0-9-]*$') { Write-Warning "mind map folder name skipped (use a-z, 0-9, -): $($d.Name)"; continue }
  $mapPath = Join-Path $d.FullName 'map.json'
  $map = 'null'; if (Test-Path $mapPath) { $map = Read-JsonRaw $mapPath }
  $turns = @(); $tdir = Join-Path $d.FullName 'turns'
  if (Test-Path $tdir) { foreach ($f in @(Get-ChildItem $tdir -Filter '*.json' | Sort-Object Name)) { $turns += Read-JsonRaw $f.FullName } }
  $grades = @(); $gdir = Join-Path $d.FullName 'grades'
  if (Test-Path $gdir) { foreach ($f in @(Get-ChildItem $gdir -Filter '*.json' | Sort-Object Name)) { $grades += Read-JsonRaw $f.FullName } }
  $refPath = Join-Path $d.FullName 'reference.json'
  $ref = 'null'; if (Test-Path $refPath) { $ref = Read-JsonRaw $refPath }
  $minds += '{"map_id":"' + $d.Name + '","map":' + $map + ',"turns":[' + ($turns -join ',') + '],"grades":[' + ($grades -join ',') + '],"reference":' + $ref + '}'
  Write-Host ("  mind map: {0} ({1}, {2} turns, {3} grades)" -f $d.Name, $(if ($map -eq 'null') { 'not read yet' } else { 'read' }), $turns.Count, $grades.Count)
}
$bundled += "`n" + '<script type="application/json" id="bundled-mindmaps">[' + ($minds -join ',') + ']</script>'

# The browser page looks for photos at mindmaps/<id>/views/ next to Kartotek-DSR.html (review finding S4): copy them there.
# That folder is build output (git-ignored). Skipped when the content folder is this folder, because the files are already there.
$photoMirror = Join-Path $root 'mindmaps'
if ((Join-Path $contentRoot 'mindmaps') -ne $photoMirror) {
  $mirrored = 0
  foreach ($d in $mindDirs) {
    $views = Join-Path $d.FullName 'views'
    if ($d.Name -notmatch '^[a-z0-9][a-z0-9-]*$' -or -not (Test-Path $views)) { continue }
    $dest = Join-Path (Join-Path $photoMirror $d.Name) 'views'
    foreach ($f in @(Get-ChildItem $views -File -Recurse | Where-Object { $_.Extension -match '^\.(jpe?g|png|webp|gif)$' })) {
      $rel = $f.FullName.Substring($views.Length).TrimStart('\', '/')
      $target = Join-Path $dest $rel
      New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
      Copy-Item $f.FullName $target -Force; $mirrored++
    }
  }
  if ($mirrored) { Write-Host ("  photos: {0} copied to {1} for the browser page" -f $mirrored, $photoMirror) }
}

# ---------------------------------------------------------------- inline the app
$html = Read-Utf8 (Join-Path $src 'index.html')
$css = Read-Utf8 (Join-Path $src 'styles.css')
$uiCss = Read-Utf8 (Join-Path $src 'ui.css')
$split = $html.IndexOf('<div id="root">')
if ($split -lt 0) { throw 'index.html: <div id="root"> not found' }
$head = $html.Substring(0, $split).Replace('<link rel="stylesheet" href="styles.css">', "<style>`n$css`n</style>").Replace('<link rel="stylesheet" href="ui.css">', "<style>`n$uiCss`n</style>")
$body = $html.Substring($split)

$scriptPattern = '<script src="([^"]+)"></script>'
$names = [regex]::Matches($body, $scriptPattern) | ForEach-Object { $_.Groups[1].Value }
$first = $true
foreach ($n in $names) {
  $js = Read-Utf8 (Join-Path $src $n)
  if ($js.Contains('</script')) { throw "$n contains a closing script tag" }
  $inline = "<script>/* $n */`n$js`n</script>"
  if ($first) { $inline = $bundled + "`n" + $inline; $first = $false }
  $body = $body.Replace("<script src=`"$n`"></script>", $inline)
}
if ($body.Contains('<script src=')) { throw 'unresolved script reference' }

$out = "<!doctype html>`n<!-- Kartotek: MIT licence. This page bundles third-party software (React, Motion, Phosphor Icons, Tailwind CSS output, stageshow, Inter font); licence texts: THIRD-PARTY-NOTICES.md in the repository. -->`n<html lang=`"en`">`n<head>`n$head</head>`n<body>`n$body</body>`n</html>`n"
$appPath = Join-Path $root 'Kartotek-DSR.html'
[IO.File]::WriteAllText($appPath, $out, $utf8)
Write-Host ("  app : {0} ({1:N0} characters, {2} scripts, {3} studies, {4} lesson tests, {5} mocks, {6} mind maps)" -f $appPath, $out.Length, @($names).Count, $packages.Count, $lessons.Count, $mocks.Count, $minds.Count)

# ---------------------------------------------------------------- note sheets -> PDF
if ($SkipPdf) { return }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { Write-Warning 'Microsoft Edge not found; skipping PDF export.'; return }
$profileDir = Join-Path $env:TEMP 'kartotek-edge'
$notesDir = if ($contentDir) { Join-Path $contentDir 'notes' } else { Join-Path $root 'notes' }
New-Item -ItemType Directory -Force $notesDir | Out-Null
foreach ($d in $etutDirs) {
  if ($Only -and $d.Name -ne $Only) { continue }
  $note = Join-Path $d.FullName 'note-sheet.html'
  if (-not (Test-Path $note)) { continue }
  $pdf = Join-Path $d.FullName 'note-sheet.pdf'
  if (Test-Path $pdf) { Remove-Item $pdf -Force }
  $url = 'file:///' + ($note -replace '\\', '/')
  $edgeArgs = @('--headless', '--disable-gpu', '--no-first-run', '--no-pdf-header-footer', '--print-to-pdf-no-header',
            "--user-data-dir=$profileDir", '--virtual-time-budget=6000', "--print-to-pdf=$pdf", $url)
  $p = Start-Process -FilePath $edge -ArgumentList $edgeArgs -Wait -PassThru -NoNewWindow -RedirectStandardError (Join-Path $env:TEMP 'kartotek-edge-err.txt') -RedirectStandardOutput (Join-Path $env:TEMP 'kartotek-edge-out.txt')
  if (-not (Test-Path $pdf)) { throw "PDF was not created for $($d.Name) (Edge exit code $($p.ExitCode))" }
  Copy-Item $pdf (Join-Path $notesDir ($d.Name + '.pdf')) -Force
  Write-Host ("  pdf : {0} ({1:N0} bytes)" -f (Join-Path $notesDir ($d.Name + '.pdf')), (Get-Item $pdf).Length)
}
