# Explicit hosted verification inputs, never an application installer/fallback.
# Both NuGet hashes are pinned to Microsoft's official immutable catalog data.
param(
    [ValidateSet('generic', 'manga')][string]$Profile = 'generic',
    [string]$DetectorDirectory
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$ProgressPreference = 'SilentlyContinue'
$root = Join-Path (Get-Location) 'target/native-ocr-qa'
$runtime = Join-Path $root 'runtime'
$models = Join-Path $root "models-$Profile"
New-Item -ItemType Directory -Force $root, $runtime, $models | Out-Null

function Get-Pinned($Url, $Target, $Digest, $Algorithm = 'SHA256') {
    if (-not (Test-Path -LiteralPath $Target)) {
        Invoke-WebRequest -Uri $Url -OutFile $Target -TimeoutSec 300
    }
    if ((Get-Item -LiteralPath $Target).Length -gt 512MB) {
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

Get-Pinned 'https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/v3.7.0/LICENSE' (Join-Path $models 'PaddleOCR-LICENSE.txt') '3840c5c0c61c294264d2dd77b8777be6ddd90121ef4e0e64abcd22edea581d6e'
if ($Profile -eq 'generic') {
    $base = 'https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv6'
    Get-Pinned "$base/det/PP-OCRv6_det_small.onnx" (Join-Path $models 'PP-OCRv6_det_small.onnx') '090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f'
    Get-Pinned "$base/rec/PP-OCRv6_rec_small.onnx" (Join-Path $models 'PP-OCRv6_rec_small.onnx') '6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884'
    $id = 'org.mlearn.paddle-ctc.onnx.v1'
    $label = 'PaddleOCR v6 Generic CTC'
    $executor = 'paddle-ctc-onnx-v1'
    $modelProfile = @{
        schemaVersion = 1
        executor = $executor
        detector = @{ path = 'PP-OCRv6_det_small.onnx'; input = 'x'; output = 'fetch_name_0' }
        recognizer = @{ path = 'PP-OCRv6_rec_small.onnx'; input = 'x'; output = 'fetch_name_0' }
    }
    $provenance = @{
        schemaVersion = 1
        sourceRelease = 'RapidOCR v3.9.2'
        attribution = 'Upstream weights: Baidu and/or PaddleOCR rights holders; converted artifacts and metadata: RapidOCR Authors.'
        licenseDeclaration = 'Apache-2.0'
    }
} else {
    if (-not $DetectorDirectory) { throw 'Tuned Japanese verification requires the same-run converted detector artifact.' }
    $expected = ((Get-Content -LiteralPath (Join-Path $DetectorDirectory 'detector.sha256') -Raw) -split '\s+')[0]
    if ($expected -notmatch '^[0-9a-f]{64}$' -or
        (Get-FileHash -LiteralPath (Join-Path $DetectorDirectory 'detector.onnx') -Algorithm SHA256).Hash -ne $expected) {
        throw 'Converted detector artifact identity mismatch.'
    }
    Copy-Item (Join-Path $DetectorDirectory 'detector.onnx') (Join-Path $models 'detector.onnx')
    Copy-Item (Join-Path $DetectorDirectory 'conversion.log') (Join-Path $models 'detector-conversion.log')
    $manga = Join-Path $models 'manga'
    New-Item -ItemType Directory -Force $manga | Out-Null
    $base = 'https://huggingface.co/mayocream/manga-ocr-onnx/resolve/24b12778d85800835e2ca409236de281b8ab7b9f'
    Get-Pinned "$base/encoder_model.onnx" (Join-Path $manga 'encoder_model.onnx') '15fa8155fe9bc1a7d25d9bb353debaa4def033d0174e907dbd2dd6d995def85f'
    Get-Pinned "$base/decoder_model.onnx" (Join-Path $manga 'decoder_model.onnx') 'ef7765261e9d1cdc34d89356986c2bbc2a082897f753a89605ae80fdfa61f5e8'
    Get-Pinned "$base/vocab.txt" (Join-Path $manga 'vocab.txt') '5cb5c5586d98a2f331d9f8828e4586479b0611bfba5d8c3b6dadffc84d6a36a3'
    Get-Pinned 'https://raw.githubusercontent.com/kha-white/manga-ocr/master/LICENSE' (Join-Path $models 'MangaOCR-LICENSE.txt') 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4'
    Get-Pinned 'https://huggingface.co/cl-tohoku/bert-base-japanese-char-v2/resolve/e17e40a15857ad47d63f6eb4cc9fb62c136d2301/README.md' (Join-Path $models 'Tokenizer-README.md') '9ab81ae79c752a7c8dd7bb95d70b4150894b80e29337d905b9a5731ab3839689'
    $id = 'org.mlearn.paddle-manga.onnx.v1'
    $label = 'Japanese PaddleOCR v6 + MangaOCR'
    $executor = 'paddle-manga-onnx-v1'
    $modelProfile = @{
        schemaVersion = 1
        executor = $executor
        detector = @{ path = 'detector.onnx'; input = 'x'; output = 'fetch_name_0' }
        recognizerDirectory = 'manga'
    }
    $provenance = @{
        schemaVersion = 1
        detectorSource = 'PaddlePaddle/PP-OCRv6_medium_det@8e0f56fb2ef86b461d99cfc7ac5c137738985f61'
        detectorOnnxSha256 = $expected
        mangaSource = 'mayocream/manga-ocr-onnx@24b12778d85800835e2ca409236de281b8ab7b9f'
        tokenizerStatus = 'Upstream metadata CC-BY-SA-4.0 / prose CC-BY-SA-3.0 retained verbatim; distribution discrepancy unresolved.'
        purpose = 'Hosted private verification, not release license approval; no Python OCR runtime.'
    }
}
$modelProfile | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $models 'profile.json') -Encoding utf8
$provenance | ConvertTo-Json | Set-Content (Join-Path $models 'provenance.json') -Encoding utf8
@{
    id = $id
    label = $label
    executor = $executor
} | ConvertTo-Json | Set-Content (Join-Path $root "profile-$Profile.json") -Encoding utf8
node tools/prepare-plugins.mjs --sign-bundle
cargo run --locked -p mlearn-runtime --example package_native_ocr -- $runtime $models (Join-Path $root "package-$Profile")
node tools/sign-desktop-ocr.mjs (Join-Path $root "package-$Profile") (Join-Path $root "profile-$Profile.json")
