# Explicit hosted verification inputs, never an application installer/fallback.
# Both NuGet hashes are pinned to Microsoft's official immutable catalog data.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$ProgressPreference = 'SilentlyContinue'
$root = Join-Path (Get-Location) 'target/native-ocr-qa'
$runtime = Join-Path $root 'runtime'
$models = Join-Path $root 'models'
New-Item -ItemType Directory -Force $root, $runtime, $models | Out-Null

function Get-Pinned($Url, $Target, $Digest, $Algorithm = 'SHA256') {
    if (-not (Test-Path -LiteralPath $Target)) {
        Invoke-WebRequest -Uri $Url -OutFile $Target -TimeoutSec 300
    }
    if ((Get-Item -LiteralPath $Target).Length -gt 256MB) {
        throw "Hosted OCR input exceeds its archive bound: $Target"
    }
    $expected = if ($Algorithm -eq 'SHA512') {
        [Convert]::ToHexString([Convert]::FromBase64String($Digest))
    } else { $Digest }
    if ((Get-FileHash -LiteralPath $Target -Algorithm $Algorithm).Hash -ne $expected) {
        throw "Hosted OCR input identity mismatch: $Target"
    }
}

$ort = Join-Path $root 'ort.zip'
Get-Pinned 'https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/1.24.2/microsoft.ml.onnxruntime.directml.1.24.2.nupkg' $ort 'aCMqNSeCJCIAwXMMkt+IRHREbJWfCY9lLi23afOvF3mgRYWMkVN4oJgB4JEtmyi/oLLwaKLIFS/Y0FH41WKnuQ==' 'SHA512'
$dml = Join-Path $root 'directml.zip'
Get-Pinned 'https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/1.15.4/microsoft.ai.directml.1.15.4.nupkg' $dml '/edn9WkEq8kP1T9l2HKckYq39uPF4ezdR5kI/AK0U1zysIYPerKsubcx1suAm3LD1dTQKFP7j16gIqR7xE7yhQ==' 'SHA512'
Expand-Archive -LiteralPath $ort -DestinationPath (Join-Path $root 'ort') -Force
Expand-Archive -LiteralPath $dml -DestinationPath (Join-Path $root 'directml') -Force
Copy-Item (Join-Path $root 'ort/runtimes/win-x64/native/*.dll') $runtime
Copy-Item (Join-Path $root 'directml/bin/x64-win/DirectML.dll') $runtime
Copy-Item (Join-Path $root 'ort/LICENSE') (Join-Path $runtime 'ONNXRuntime-LICENSE.txt')
Copy-Item (Join-Path $root 'ort/ThirdPartyNotices.txt') (Join-Path $runtime 'ONNXRuntime-ThirdPartyNotices.txt')
Copy-Item (Join-Path $root 'directml/LICENSE.txt') (Join-Path $runtime 'DirectML-LICENSE.txt')
Copy-Item (Join-Path $root 'directml/LICENSE-CODE.txt') (Join-Path $runtime 'DirectML-LICENSE-CODE.txt')
Copy-Item (Join-Path $root 'directml/ThirdPartyNotices.txt') (Join-Path $runtime 'DirectML-ThirdPartyNotices.txt')

$base = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv6'
Get-Pinned "$base/det/PP-OCRv6_det_small.onnx" (Join-Path $models 'PP-OCRv6_det_small.onnx') '090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f'
Get-Pinned "$base/rec/PP-OCRv6_rec_small.onnx" (Join-Path $models 'PP-OCRv6_rec_small.onnx') '6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884'
Get-Pinned 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/v3.7.0/LICENSE' (Join-Path $models 'PaddleOCR-LICENSE.txt') '3840c5c0c61c294264d2dd77b8777be6ddd90121ef4e0e64abcd22edea581d6e'
@{
    schemaVersion = 1
    executor = 'paddle-ctc-onnx-v1'
    detector = @{ path = 'PP-OCRv6_det_small.onnx'; input = 'x'; output = 'fetch_name_0' }
    recognizer = @{ path = 'PP-OCRv6_rec_small.onnx'; input = 'x'; output = 'fetch_name_0' }
} | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $models 'profile.json') -Encoding utf8
@{
    schemaVersion = 1
    sourceRelease = 'RapidOCR v3.9.2'
    attribution = 'Upstream weights: Baidu and/or PaddleOCR rights holders; converted artifacts and metadata: RapidOCR Authors.'
    licenseDeclaration = 'Apache-2.0'
    purpose = 'Hosted native verification only; no Python OCR runtime'
} | ConvertTo-Json | Set-Content (Join-Path $models 'provenance.json') -Encoding utf8
@{
    id = 'org.mlearn.paddle-ctc.onnx.v1'
    label = 'PaddleOCR v6 Generic CTC'
    executor = 'paddle-ctc-onnx-v1'
} | ConvertTo-Json | Set-Content (Join-Path $root 'profile.json') -Encoding utf8
node tools/prepare-plugins.mjs --sign-bundle
cargo run --locked -p mlearn-runtime --example package_native_ocr -- $runtime $models (Join-Path $root 'package')
node tools/sign-desktop-ocr.mjs (Join-Path $root 'package') (Join-Path $root 'profile.json')
