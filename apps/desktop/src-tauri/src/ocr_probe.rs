//! Opt-in standalone verification, not an application/device workflow.
use crate::{NativeState, ocr};
use mlearn_core::{OcrRect, OcrRequest};
use mlearn_language_host::CodePolicy;
use mlearn_runtime::{
    Runtime, RuntimeExecutor, catalog::CatalogTrust, native_ocr::NativeOcrModels,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{Arc, Mutex},
    time::Instant,
};

fn call(runtime: &RuntimeExecutor, request: Value) -> Result<Value, String> {
    let value: Value =
        serde_json::from_str(&runtime.execute(&request.to_string())).map_err(|e| e.to_string())?;
    if value["type"] == "error" {
        return Err(format!("Runtime action failed: {value}"));
    }
    Ok(value)
}
pub async fn run(
    root: &Path,
    fixtures: &Path,
    trust: CatalogTrust,
    generic: bool,
) -> Result<Value, String> {
    let run_id = uuid::Uuid::new_v4().to_string();
    let (profile, package, provider, language) = if generic {
        (
            "org.mlearn.paddle-ctc.onnx.v1",
            "org.mlearn.english",
            "org.mlearn.english.paddle-ctc",
            "en",
        )
    } else {
        (
            "org.mlearn.paddle-manga.onnx.v1",
            "org.mlearn.japanese",
            "org.mlearn.japanese.paddle-manga",
            "ja",
        )
    };
    let models = Arc::new(NativeOcrModels::new(root, Some(trust.clone()))?);
    {
        let install = models.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let available = install
                .list()?
                .into_iter()
                .find(|m| m.profile.id == profile)
                .ok_or("Tuned profile absent from catalog")?
                .profile
                .revision()?;
            let current = match install.installed(profile) {
                Ok(p) => Some(p.revision()?),
                Err(_) => None,
            };
            if current.as_ref() == Some(&available) {
                Ok(())
            } else {
                install.install(profile)
            }
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    println!("OCR_PROBE authenticated_install=passed");
    let runtime = Runtime::open(
        root,
        CodePolicy::DesktopDownloaded,
        Some(trust.clone()),
        vec![],
    )?;
    let documents = crate::document_resolver(&runtime)?;
    let runtime = Arc::new(RuntimeExecutor::new(runtime));
    let install_runtime = runtime.clone();
    let install_id = format!("ocr-probe-{language}-{run_id}");
    tauri::async_runtime::spawn_blocking(move || {
        call(
            &install_runtime,
            json!({"type":"install_package","command":{"commandId":install_id,"pluginId":package}}),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    let names = [
        "vertical-ruby.png",
        "horizontal-mixed.png",
        "low-contrast-glare.png",
        "spread.png",
        "spread-right-crop.png",
        "no-text.png",
    ];
    let mut paths = names
        .iter()
        .map(|name| fixtures.join(name))
        .collect::<Vec<_>>();
    paths.push(root.join("large-native.png"));
    paths.push(root.join("blank.png"));
    let source=call(&runtime,json!({"type":"import_image_collection","paths":paths,"title":"Isolated OCR owner verification","packageId":package}))?["window"]["source"].clone();
    let source_id = source["id"]
        .as_str()
        .ok_or("Imported source lacks identity")?
        .to_owned();
    let state = NativeState {
        clipboard: Mutex::new(None),
        captures: Arc::new(crate::media_capture::Captures::new()),
        media_base: String::new(),
        runtime: runtime.clone(),
        permits: Arc::new(tokio::sync::Semaphore::new(3)),
        read_controls: Arc::new(tokio::sync::Semaphore::new(2)),
        material: Arc::new(Mutex::new(crate::window_material::WindowMaterial::default())),
        documents,
        ocr: Arc::new(ocr::OcrJobs::new()),
        ocr_models: models.clone(),
    };
    let mut pages = Vec::new();
    let mut descriptors = Vec::new();
    for (i, name) in names.iter().enumerate() {
        let page = call(
            &runtime,
            json!({"type":"image_page","sourceId":source_id,"pageIndex":i}),
        )?["page"]
            .clone();
        let request:OcrRequest=serde_json::from_value(json!({"requestId":format!("{run_id}-{i}"),"sourceId":source_id,"contentRevision":page["contentRevision"],
            "resourceId":page["resourceId"],"providerId":provider,"recognitionLanguages":[language],"crop":null})).map_err(|e|e.to_string())?;
        state.ocr.reserve(request.request_id.clone())?;
        let start = Instant::now();
        let raw: Value = serde_json::from_str(
            &ocr::recognize_owned(&state, request.request_id.clone(), request).await?,
        )
        .map_err(|e| e.to_string())?;
        let evidence = call(
            &runtime,
            json!({"type":"ocr_evidence","sourceId":source_id,"resourceId":page["resourceId"],"ocrRevision":raw["page"]["ocrRevision"]}),
        )?;
        let projected = call(
            &runtime,
            json!({"type":"postprocess_ocr","sourceId":source_id,"resourceId":page["resourceId"],"ocrRevision":raw["page"]["ocrRevision"]}),
        )?;
        let display = ocr::display_owned(
            &state,
            source_id.clone(),
            page["resourceId"]
                .as_str()
                .ok_or("Missing resource")?
                .into(),
            None,
        )
        .await?;
        if !display.starts_with("data:image/png;base64,") {
            return Err("Display did not return bounded upright PNG".into());
        }
        if !generic && *name == "vertical-ruby.png" {
            let regions = projected["page"]["regions"]
                .as_array()
                .ok_or("No OCR regions")?;
            for expected in ["日本語を読む", "青い本です", "にほんご"] {
                if !regions.iter().any(|r| r["text"] == expected) {
                    return Err(format!("Missing tuned vertical output: {expected}"));
                }
            }
            if !regions.iter().any(|r| r["readingOf"].is_string())
                || !regions.iter().any(|r| {
                    r["contextRegionIds"]
                        .as_array()
                        .is_some_and(|v| v.len() == 2)
                })
            {
                return Err("Japanese package did not assign ruby/context relationships".into());
            }
        }
        if !generic
            && *name == "horizontal-mixed.png"
            && raw["page"]["regions"].as_array().map_or(0, Vec::len) != 2
        {
            return Err("Horizontal grouping regression merged independent lines".into());
        }
        if generic && *name == "horizontal-mixed.png" {
            let regions = raw["page"]["regions"]
                .as_array()
                .ok_or("No generic OCR regions")?;
            if !regions.iter().any(|region| {
                region["text"] == "Open the blue book. 42"
                    && region["candidates"][0]["confidence"]
                        .as_f64()
                        .is_some_and(|score| score >= 0.9)
            }) {
                return Err(
                    "Generic CTC did not recognize the English fixture with actual confidence"
                        .into(),
                );
            }
            let stages = &evidence["evidence"]["result"]["stageEvidence"];
            if stages["rawRecognition"]
                .as_array()
                .is_none_or(|texts| !texts.iter().any(|text| text == "Open the blue book. 42"))
            {
                return Err("Generic CTC raw evidence was lost or normalized as Japanese".into());
            }
        }
        println!(
            "OCR_PROBE case={name} elapsed_ms={} regions={}",
            start.elapsed().as_millis(),
            raw["page"]["regions"].as_array().map_or(0, Vec::len)
        );
        pages.push(json!({"file":name,"inputSha256":format!("{:x}",Sha256::digest(std::fs::read(fixtures.join(name)).map_err(|e|e.to_string())?)),
            "elapsedMs":start.elapsed().as_secs_f64()*1000.0,"raw":raw,"projected":projected,"evidence":evidence,"displayCharacters":display.len()}));
        descriptors.push(page);
    }
    // Crop from ORIGINAL spread pixels; source geometry remains page-local.
    let request:OcrRequest=serde_json::from_value(json!({"requestId":format!("{run_id}-crop"),"sourceId":source_id,
        "contentRevision":descriptors[3]["contentRevision"],"resourceId":descriptors[3]["resourceId"],
        "providerId":provider,"recognitionLanguages":[language],
        "crop":{"x":0.52,"y":35.0/450.0,"width":0.45,"height":100.0/450.0}})).map_err(|e|e.to_string())?;
    state.ocr.reserve(request.request_id.clone())?;
    let crop: Value = serde_json::from_str(
        &ocr::recognize_owned(&state, request.request_id.clone(), request).await?,
    )
    .map_err(|e| e.to_string())?;
    let crop_evidence = call(
        &runtime,
        json!({"type":"ocr_evidence","sourceId":source_id,"resourceId":descriptors[3]["resourceId"],"ocrRevision":crop["page"]["ocrRevision"]}),
    )?;
    if crop_evidence["evidence"]["result"]["stageEvidence"]["detections"] != json!([])
        || crop_evidence["evidence"]["result"]["regions"]
            .as_array()
            .map_or(0, Vec::len)
            != 1
    {
        return Err("Explicit crop did not retain its genuine detector-bypass evidence".into());
    }
    let magnifier = ocr::display_owned(
        &state,
        source_id.clone(),
        descriptors[3]["resourceId"]
            .as_str()
            .ok_or("Missing spread resource")?
            .into(),
        Some(OcrRect {
            x: 0.52,
            y: 35.0 / 450.0,
            width: 0.45,
            height: 100.0 / 450.0,
        }),
    )
    .await?;
    let blank_page = call(
        &runtime,
        json!({"type":"image_page","sourceId":source_id,"pageIndex":7}),
    )?["page"]
        .clone();
    let blank_request:OcrRequest=serde_json::from_value(json!({"requestId":format!("{run_id}-blank"),"sourceId":source_id,
        "contentRevision":blank_page["contentRevision"],"resourceId":blank_page["resourceId"],"providerId":provider,
        "recognitionLanguages":[language],"crop":null})).map_err(|e|e.to_string())?;
    state.ocr.reserve(blank_request.request_id.clone())?;
    let blank: Value = serde_json::from_str(
        &ocr::recognize_owned(&state, blank_request.request_id.clone(), blank_request).await?,
    )
    .map_err(|e| e.to_string())?;
    if blank["page"]["regions"] != json!([]) {
        return Err("Blank detector result invented a whole-page recognition".into());
    }
    let native_page = call(
        &runtime,
        json!({"type":"image_page","sourceId":source_id,"pageIndex":6}),
    )?["page"]
        .clone();
    let native_pixels = ocr::display_owned(
        &state,
        source_id.clone(),
        native_page["resourceId"]
            .as_str()
            .ok_or("Missing native pixel resource")?
            .into(),
        Some(OcrRect {
            x: 0.75,
            y: 0.25,
            width: 0.125,
            height: 0.25,
        }),
    )
    .await?;
    let pdf_source = call(
        &runtime,
        json!({"type":"open_document","path":fixtures.join("image-only.pdf"),"packageId":package}),
    )?["window"]["source"]
        .clone();
    let pdf_page = call(
        &runtime,
        json!({"type":"image_page","sourceId":pdf_source["id"],"pageIndex":0}),
    )?["page"]
        .clone();
    let pdf_request:OcrRequest=serde_json::from_value(json!({"requestId":format!("{run_id}-pdf"),"sourceId":pdf_source["id"],
        "contentRevision":pdf_page["contentRevision"],"resourceId":pdf_page["resourceId"],"providerId":provider,
        "recognitionLanguages":[language],"crop":null})).map_err(|e|e.to_string())?;
    state.ocr.reserve(pdf_request.request_id.clone())?;
    let pdf: Value = serde_json::from_str(
        &ocr::recognize_owned(&state, pdf_request.request_id.clone(), pdf_request).await?,
    )
    .map_err(|e| e.to_string())?;
    if pdf["page"]["regions"].as_array().is_none_or(Vec::is_empty) {
        return Err("Image-only PDF returned no actual tuned text".into());
    }
    let pdf_display = ocr::display_owned(
        &state,
        pdf_source["id"]
            .as_str()
            .ok_or("Missing PDF identity")?
            .into(),
        pdf_page["resourceId"]
            .as_str()
            .ok_or("Missing PDF page resource")?
            .into(),
        None,
    )
    .await?;
    // Subscribe before inference. Cancel an actual child after detection and
    // package grouping have finished and crop recognition was requested.
    let (cancelled, display) = {
        let signal = state.ocr.recognizing.notified();
        tokio::pin!(signal);
        signal.as_mut().enable();
        let cancel_id = format!("{run_id}-cancel");
        state.ocr.reserve(cancel_id.clone())?;
        let request:OcrRequest=serde_json::from_value(json!({"requestId":cancel_id,"sourceId":source_id,
        "contentRevision":descriptors[0]["contentRevision"],"resourceId":descriptors[0]["resourceId"],
        "providerId":provider,"recognitionLanguages":[language],"crop":null})).map_err(|e|e.to_string())?;
        let cancel_work = async {
            signal.await;
            // Display remains available while the inference slot is occupied.
            let display = ocr::display_owned(
                &state,
                source_id.clone(),
                descriptors[1]["resourceId"]
                    .as_str()
                    .ok_or("Missing display resource")?
                    .into(),
                None,
            )
            .await?;
            state.ocr.cancel(&cancel_id)?;
            call(&runtime, json!({"type":"cancel_ocr","requestId":cancel_id}))?;
            Ok::<_, String>(display.len())
        };
        tokio::time::timeout(std::time::Duration::from_secs(180), async {
            tokio::join!(
                ocr::recognize_owned(&state, cancel_id.clone(), request),
                cancel_work
            )
        })
        .await
        .map_err(|_| "Cancellation verification timed out")?
    };
    if cancelled.is_ok() {
        return Err("Cancelled child published a stale OCR page".into());
    }
    let display = display?;
    state.ocr.reserve("after-cancel".into())?;
    state.ocr.cancel("after-cancel")?;
    let tested = ocr::test_owned(&state, profile.into()).await?;
    let providers = ocr::providers_owned(&state).await?;
    if !providers
        .iter()
        .any(|p| p.id == provider && p.availability == mlearn_core::OcrAvailability::Ready)
        || cfg!(target_os = "macos") && !providers.iter().any(|p| p.id == "apple.vision.legacy")
    {
        return Err(
            "Actual native provider discovery omitted an executing desktop provider".into(),
        );
    }
    let projected = pages[0]["projected"]["page"].clone();
    state.ocr.begin_shutdown();
    state.ocr.drain().await;
    if !state.ocr.shutdown_finished() {
        return Err("Native OCR workers outlived shutdown".into());
    }
    drop(state);
    drop(runtime);
    let reopened = RuntimeExecutor::new(Runtime::open(
        root,
        CodePolicy::DesktopDownloaded,
        Some(trust),
        vec![],
    )?);
    let restored = call(
        &reopened,
        json!({"type":"read_ocr","sourceId":source_id,"resourceId":descriptors[0]["resourceId"],"ocrRevision":projected["ocrRevision"]}),
    )?;
    if restored["page"] != projected {
        return Err("Immutable OCR projection changed across restart".into());
    }
    let report = json!({"profileId":profile,"root":root,"pages":pages,"crop":crop,"cropEvidence":crop_evidence,"blank":blank,"pdf":pdf,
        "pdfInputSha256":format!("{:x}",Sha256::digest(std::fs::read(fixtures.join("image-only.pdf")).map_err(|e|e.to_string())?)),
        "pdfDisplayCharacters":pdf_display.len(),"magnifierCharacters":magnifier.len(),"nativePixelDisplayUri":native_pixels,
        "cancelled":cancelled.unwrap_err(),"displayDuringInferenceCharacters":display,"modelTest":tested,"providers":providers,"restartPersistence":true});
    std::fs::write(
        root.join("desktop-ocr-results.json"),
        serde_json::to_vec(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    println!("OCR_PROBE cancellation_display_restart=passed");
    Ok(
        json!({"report":root.join("desktop-ocr-results.json"),"cases":names.len(),"restartPersistence":true,"cancelledChildReaped":true}),
    )
}
