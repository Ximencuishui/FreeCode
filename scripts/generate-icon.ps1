# FreeCoder app icon generator.
# Produces resources/icons/icon.png (512x512) and icon.ico (16..256, multi-size).
# Design: brand-blue gradient rounded square + white code brackets </> + sparkle.
# Usage: powershell -File scripts/generate-icon.ps1
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\resources\icons'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

function New-RoundedRectPath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $path.AddArc($x, $y, $d, $d, 180, 90)
  $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $path.CloseFigure()
  return $path
}

# Rounded square (margin 32, corner radius 112)
$rect = New-RoundedRectPath 32 32 448 448 112
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
  (New-Object System.Drawing.Point(32, 24)),
  (New-Object System.Drawing.Point(480, 488)),
  [System.Drawing.Color]::FromArgb(255, 91, 155, 232),   # #5B9BE8
  [System.Drawing.Color]::FromArgb(255, 46, 110, 181)   # #2E6EB5
)
$g.FillPath($grad, $rect)
$grad.Dispose()
$rect.Dispose()

# Code brackets </> : '<' and '>' strokes, then the middle slash
$pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 34)
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$g.DrawLines($pen, @(
  (New-Object System.Drawing.PointF(158, 170)),
  (New-Object System.Drawing.PointF(86, 256)),
  (New-Object System.Drawing.PointF(158, 342))
))
$g.DrawLines($pen, @(
  (New-Object System.Drawing.PointF(354, 170)),
  (New-Object System.Drawing.PointF(426, 256)),
  (New-Object System.Drawing.PointF(354, 342))
))
$g.DrawLine($pen, 306, 152, 206, 360)
$pen.Dispose()

# Sparkle: 4-point star centered at (416, 96), outer 34, inner 12
$star = @(
  (New-Object System.Drawing.PointF(416, 62)),
  (New-Object System.Drawing.PointF(422, 90)),
  (New-Object System.Drawing.PointF(450, 96)),
  (New-Object System.Drawing.PointF(422, 102)),
  (New-Object System.Drawing.PointF(416, 130)),
  (New-Object System.Drawing.PointF(410, 102)),
  (New-Object System.Drawing.PointF(382, 96)),
  (New-Object System.Drawing.PointF(410, 90))
)
$starBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 224, 138)) # #FFE08A
$g.FillPolygon($starBrush, $star)
$starBrush.Dispose()

$pngPath = Join-Path $outDir 'icon.png'
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Host "PNG: $pngPath"

# ---------- Build ICO (multi-size, PNG frames) ----------
$sizes = @(16, 24, 32, 48, 64, 128, 256)
$frames = @()
foreach ($s in $sizes) {
  $small = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $sg = [System.Drawing.Graphics]::FromImage($small)
  $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $sg.DrawImage($bmp, 0, 0, $s, $s)
  $ms = New-Object System.IO.MemoryStream
  $small.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames += , $ms.ToArray()
  $sg.Dispose()
  $small.Dispose()
  $ms.Dispose()
}
$g.Dispose()
$bmp.Dispose()

$icoPath = Join-Path $outDir 'icon.ico'
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([uint16]0)                  # reserved
$bw.Write([uint16]1)                  # type: icon
$bw.Write([uint16]$sizes.Count)       # count
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]
  $w = 0
  if ($s -lt 256) { $w = $s }
  $bw.Write([byte]$w)                 # width (256 => 0)
  $bw.Write([byte]$w)                 # height
  $bw.Write([byte]0)                  # color count
  $bw.Write([byte]0)                  # reserved
  $bw.Write([uint16]1)                # planes
  $bw.Write([uint16]32)               # bit count
  $bw.Write([uint32]$frames[$i].Length)
  $bw.Write([uint32]$offset)
  $offset += $frames[$i].Length
}
foreach ($frame in $frames) {
  $bw.Write($frame)
}
$bw.Flush()
$bw.Dispose()
$fs.Dispose()
Write-Host "ICO: $icoPath ($($sizes -join ', ') px)"
