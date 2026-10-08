param([int]$Port = 8000)

$root = (Resolve-Path $PSScriptRoot).Path
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
Write-Host "Dashboard server: http://localhost:$Port/"

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.csv'  = 'text/csv; charset=utf-8'
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)
    $requestLine = $reader.ReadLine()
    while (($line = $reader.ReadLine()) -and $line.Length -gt 0) { }
    $requestParts = $requestLine -split ' '
    $relative = if ($requestParts.Length -ge 2) { [Uri]::UnescapeDataString(([string]$requestParts[1]).Split('?')[0].TrimStart('/')) } else { '' }
    if ([string]::IsNullOrWhiteSpace($relative)) { $relative = 'index.html' }
    $file = Join-Path $root ($relative -replace '/', '\')

    if ((Test-Path -LiteralPath $file -PathType Leaf) -and ((Resolve-Path $file).Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase))) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $extension = [System.IO.Path]::GetExtension($file).ToLowerInvariant()
      $contentType = if ($mimeTypes.ContainsKey($extension)) { $mimeTypes[$extension] } else { 'application/octet-stream' }
      $header = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    } else {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes('Not found')
      $header = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    }
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $responseBytes = New-Object byte[] ($headerBytes.Length + $bytes.Length)
    [System.Array]::Copy($headerBytes, 0, $responseBytes, 0, $headerBytes.Length)
    [System.Array]::Copy($bytes, 0, $responseBytes, $headerBytes.Length, $bytes.Length)
    $stream.Write($responseBytes, 0, $responseBytes.Length)
    $stream.Flush()
    $stream.Close()
    $client.Close()
  }
} finally {
  $listener.Stop()
}
