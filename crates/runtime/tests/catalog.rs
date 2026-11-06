use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use mlearn_runtime::catalog::{Artifact, verify_artifact, verify_catalog};
use sha2::{Digest, Sha256};

mod readiness {
    use super::*;
    use mlearn_language_host::{AssetMap, CodePolicy, CompiledPlugin};
    use mlearn_runtime::{
        Runtime, RuntimeExecutor,
        catalog::{CatalogTrust, Manifest},
    };
    use serde_json::{Value, json};
    use std::{
        collections::BTreeMap,
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        path::PathBuf,
        sync::{Arc, Mutex, mpsc},
        thread,
    };

    struct Catalog {
        address: std::net::SocketAddr,
        replies: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
        hold: Arc<Mutex<Option<StreamHold>>>,
        server: Option<thread::JoinHandle<()>>,
    }
    struct StreamHold {
        path: String,
        entered: mpsc::SyncSender<()>,
        release: mpsc::Receiver<()>,
    }
    struct StreamGate {
        entered: mpsc::Receiver<()>,
        release: mpsc::SyncSender<()>,
    }
    impl Drop for StreamGate {
        fn drop(&mut self) {
            if let Err(error) = self.release.send(()) {
                eprintln!("Stream gate already closed: {error}");
            }
        }
    }
    impl Catalog {
        fn new() -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let replies = Arc::new(Mutex::new(BTreeMap::<String, Vec<u8>>::new()));
            let responses = replies.clone();
            let hold = Arc::new(Mutex::new(None::<StreamHold>));
            let held = hold.clone();
            let server = thread::spawn(move || {
                for stream in listener.incoming() {
                    let mut stream = stream.unwrap();
                    stream
                        .set_read_timeout(Some(std::time::Duration::from_secs(10)))
                        .unwrap();
                    let mut request = Vec::new();
                    let mut byte = [0];
                    while !request.ends_with(b"\r\n\r\n") {
                        assert!(request.len() < 16384);
                        stream.read_exact(&mut byte).unwrap();
                        request.push(byte[0]);
                    }
                    let request = String::from_utf8(request).unwrap();
                    let path = request.split_whitespace().nth(1).unwrap();
                    if path == "/shutdown" {
                        break;
                    }
                    let body = responses.lock().unwrap().get(path).unwrap().clone();
                    let barrier = {
                        let mut held = held.lock().unwrap();
                        if held.as_ref().is_some_and(|hold| hold.path == path) {
                            held.take()
                        } else {
                            None
                        }
                    };
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .unwrap();
                    if let Some(barrier) = barrier {
                        stream.write_all(&body[..1]).unwrap();
                        stream.flush().unwrap();
                        barrier.entered.send(()).unwrap();
                        barrier
                            .release
                            .recv_timeout(std::time::Duration::from_secs(10))
                            .unwrap();
                        if let Err(error) = stream.write_all(&body[1..]) {
                            eprintln!("Cancelled stream closed: {error}");
                        }
                    } else {
                        stream.write_all(&body).unwrap();
                    }
                }
            });
            Self {
                address,
                replies,
                hold,
                server: Some(server),
            }
        }
        fn hold(&self, path: &str) -> StreamGate {
            let (entered, ready) = mpsc::sync_channel(1);
            let (release, resumed) = mpsc::sync_channel(1);
            *self.hold.lock().unwrap() = Some(StreamHold {
                path: format!("/{path}"),
                entered,
                release: resumed,
            });
            StreamGate {
                entered: ready,
                release,
            }
        }
        fn trust(&self) -> CatalogTrust {
            CatalogTrust {
                url: format!("http://{}/catalog.json", self.address),
                public_key: STANDARD
                    .encode(SigningKey::from_bytes(&[42; 32]).verifying_key().to_bytes()),
            }
        }
        fn publish(&self, manifest: &Manifest, code: &[u8], assets: &BTreeMap<String, Vec<u8>>) {
            let payload = serde_json::to_vec(&json!({
                "schemaVersion":1, "expiresAt":4102444800_u64, "plugins":[manifest],
            }))
            .unwrap();
            let envelope = serde_json::to_vec(&json!({
                "payload":STANDARD.encode(&payload),
                "signature":STANDARD.encode(SigningKey::from_bytes(&[42; 32]).sign(&payload).to_bytes()),
            })).unwrap();
            let mut replies = self.replies.lock().unwrap();
            replies.insert("/catalog.json".into(), envelope);
            replies.insert(format!("/{}", manifest.code.path), code.to_vec());
            for (key, artifact) in &manifest.assets {
                replies.insert(format!("/{}", artifact.path), assets[key].clone());
            }
        }
    }
    impl Drop for Catalog {
        fn drop(&mut self) {
            let mut stream = TcpStream::connect(self.address).unwrap();
            stream
                .write_all(b"GET /shutdown HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .unwrap();
            self.server.take().unwrap().join().unwrap();
        }
    }
    fn bundle(id: &str) -> (Manifest, Vec<u8>, BTreeMap<String, Vec<u8>>) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
        let manifests: Vec<Manifest> =
            serde_json::from_slice(&std::fs::read(root.join("bundle.json")).unwrap()).unwrap();
        let manifest = manifests.into_iter().find(|m| m.id == id).unwrap();
        let code = std::fs::read(root.join(&manifest.code.path)).unwrap();
        let assets = manifest
            .assets
            .iter()
            .map(|(key, artifact)| {
                (
                    key.clone(),
                    std::fs::read(root.join(&artifact.path)).unwrap(),
                )
            })
            .collect();
        (manifest, code, assets)
    }
    fn artifact(bytes: &[u8]) -> Artifact {
        let digest = format!("{:x}", Sha256::digest(bytes));
        Artifact {
            path: format!("objects/{digest}.bin"),
            sha256: digest,
            byte_length: bytes.len(),
        }
    }
    fn call(runtime: &mut Runtime, request: Value) -> Value {
        serde_json::from_str(&runtime.execute(&request.to_string())).unwrap()
    }
    fn install(runtime: &mut Runtime, id: &str) -> Value {
        call(runtime, json!({"type":"install_plugin","pluginId":id}))
    }
    fn hello(runtime: &mut Runtime) -> Value {
        call(
            runtime,
            json!({"type":"invoke_plugin","pluginId":"example.hello",
            "capability":"example::hello","input":{"name":"still installed"}}),
        )
    }
    fn execute(executor: &RuntimeExecutor, request: Value) -> Value {
        serde_json::from_str(&executor.execute(&request.to_string())).unwrap()
    }

    #[test]
    fn real_catalog_pages_execute_sdk_imports_and_reuse_inspection_identity() {
        use mlearn_core::{
            CollectionCatalogPage, CollectionCatalogRequest, LanguageDescription, LexicalEntry,
            LexicalSummary, Request, Response,
        };
        use mlearn_runtime::BundledPlugin;
        use std::collections::BTreeSet;

        for id in ["org.mlearn.english", "org.mlearn.japanese"] {
            let directory = tempfile::tempdir().unwrap();
            let (manifest, code, assets) = bundle(id);
            let mut runtime = Runtime::open(
                &directory.path().join("profile"),
                CodePolicy::MobileBundled,
                None,
                vec![BundledPlugin {
                    manifest,
                    code,
                    assets: assets
                        .into_iter()
                        .map(|(key, bytes)| (key, bytes.into()))
                        .collect(),
                }],
            )
            .unwrap();
            let described = call(
                &mut runtime,
                serde_json::to_value(Request::DescribeLanguage {
                    package_id: id.into(),
                })
                .unwrap(),
            );
            let schema: LanguageDescription =
                match serde_json::from_value::<Response>(described).unwrap() {
                    Response::Language { description } => description,
                    other => panic!("{other:?}"),
                };
            let catalog = schema
                .catalog
                .as_ref()
                .expect("Real package declares its catalog");
            catalog.validate(id).unwrap();
            let mut invoke = |capability: &str, input: Value| {
                let response = call(
                    &mut runtime,
                    serde_json::to_value(Request::InvokePlugin {
                        plugin_id: id.into(),
                        capability: capability.into(),
                        input,
                    })
                    .unwrap(),
                );
                match serde_json::from_value::<Response>(response).unwrap() {
                    Response::PluginResult { output } => output,
                    other => panic!("{other:?}"),
                }
            };
            let request = CollectionCatalogRequest {
                after: None,
                limit: 3,
            };
            let first: CollectionCatalogPage = serde_json::from_value(invoke(
                "collection.targets.v1",
                serde_json::to_value(&request).unwrap(),
            ))
            .unwrap();
            assert_eq!(first.items.len(), 3);
            assert!(first.total > 6);
            assert!(first.next.is_some());
            let repeated: CollectionCatalogPage = serde_json::from_value(invoke(
                "collection.targets.v1",
                serde_json::to_value(&request).unwrap(),
            ))
            .unwrap();
            assert_eq!(repeated, first);
            let second: CollectionCatalogPage = serde_json::from_value(invoke(
                "collection.targets.v1",
                serde_json::to_value(CollectionCatalogRequest {
                    after: first.next.clone(),
                    limit: 3,
                })
                .unwrap(),
            ))
            .unwrap();
            assert_eq!(second.items.len(), 3);
            assert_eq!(second.total, first.total);
            let mut identities = BTreeSet::new();
            for item in first.items.iter().chain(&second.items) {
                assert!(identities.insert(&item.summary.target_id));
                assert!(catalog.kinds.iter().any(|kind| kind.id == item.kind));
                assert!(item.capabilities.iter().all(|id| {
                    schema
                        .capabilities
                        .iter()
                        .any(|capability| &capability.id == id)
                }));
                assert!(
                    item.levels.iter().all(|level| catalog
                        .levels
                        .iter()
                        .any(|choice| choice.scale_id == level.scale_id
                            && choice.level == level.level))
                );
                let entry: LexicalEntry = serde_json::from_value(invoke(
                    "target.inspect.v1",
                    json!({"targetId":item.summary.target_id}),
                ))
                .unwrap();
                assert_eq!(item.summary, LexicalSummary::from(entry));
            }
            assert_eq!(identities.len(), 6);
        }
    }

    #[test]
    fn authenticated_transfer_reports_progress_cancels_without_activation_and_retries() {
        // Given an installed real language package, claim and saved source.
        let directory = tempfile::tempdir().unwrap();
        let catalog = Catalog::new();
        let (original, code, assets) = bundle("org.mlearn.english");
        catalog.publish(&original, &code, &assets);
        let mut runtime = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            Some(catalog.trust()),
            vec![],
        )
        .unwrap();
        assert_eq!(install(&mut runtime, &original.id)["type"], "installed");
        let video = directory.path().join("fixture.mp4");
        let subtitles = directory.path().join("fixture.srt");
        std::fs::write(&video, b"isolated source; no playback assertion").unwrap();
        std::fs::write(
            &subtitles,
            "1\n00:00:00,000 --> 00:00:10,000\nChildren walked home.\n",
        )
        .unwrap();
        let opened = call(
            &mut runtime,
            json!({"type":"open_source","path":video,"packageId":original.id}),
        );
        let source_id = opened["window"]["source"]["id"].clone();
        assert!(source_id.is_string(), "{opened}");
        call(
            &mut runtime,
            json!({"type":"attach_subtitles","sourceId":source_id,"path":subtitles}),
        );
        let analyzed = call(
            &mut runtime,
            json!({"type":"analyze_source","sourceId":source_id,"positionMs":0}),
        );
        let key = json!({"packageId":original.id,"targetId":analyzed["batch"]["cues"][0]["tokens"][0]["targets"][0],"capability":"org.mlearn.english:meaning"});
        let claim = call(
            &mut runtime,
            json!({"type":"change_claim","change":{"key":key,"claim":true,"commandId":"retained-claim"}}),
        );
        assert_eq!(claim["type"], "claim_changed", "{claim}");
        call(
            &mut runtime,
            json!({"type":"save_position","sourceId":source_id,"positionMs":1234,"durationMs":10000}),
        );
        let executor = Arc::new(RuntimeExecutor::new(runtime));
        let before = execute(
            &executor,
            json!({"type":"resume_source","sourceId":source_id}),
        );
        let mut candidate = original.clone();
        candidate.version = "explicit-retry".into();
        catalog.publish(&candidate, &code, &assets);

        // When the signed package body is held after headers and its first byte,
        // the completed code response is already counted, but the transfer is not.
        let asset = candidate.assets.values().next().unwrap();
        let gate = catalog.hold(&asset.path);
        let command = json!({"pluginId":candidate.id,"commandId":"cancel-this-install"});
        let (finished, result) = mpsc::sync_channel(1);
        let installing = executor.clone();
        let request = json!({"type":"install_package","command":command});
        let worker = thread::spawn(move || finished.send(execute(&installing, request)).unwrap());
        gate.entered
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap();
        let status = execute(
            &executor,
            json!({"type":"package_install_status","commandId":"cancel-this-install"}),
        );
        assert_eq!(status["status"]["phase"], "downloading", "{status}");
        let downloaded = status["status"]["downloadedBytes"].as_u64().unwrap();
        let total = candidate.code.byte_length
            + candidate
                .assets
                .values()
                .map(|artifact| artifact.byte_length)
                .sum::<usize>();
        assert!(
            downloaded >= candidate.code.byte_length as u64 && downloaded < total as u64,
            "{status}"
        );
        assert_eq!(status["status"]["totalBytes"], total);
        assert!(
            std::fs::read_dir(directory.path().join("plugin-blobs"))
                .unwrap()
                .any(|entry| {
                    entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".tmp")
                }),
            "The held transfer must own a pending NamedTempFile"
        );
        assert_eq!(
            execute(
                &executor,
                json!({"type":"install_package","command":{"pluginId":candidate.id,"commandId":"competing-install"}})
            )["code"],
            "busy"
        );
        // Source cancellation has its own epoch, independent from the transfer.
        executor
            .cancellation_handle()
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        assert_eq!(
            execute(
                &executor,
                json!({"type":"package_install_status","commandId":"cancel-this-install"})
            )["status"]["phase"],
            "downloading"
        );
        assert_eq!(
            execute(
                &executor,
                json!({"type":"cancel_package_install","commandId":"older-install"})
            )["status"],
            Value::Null
        );
        assert_eq!(
            execute(
                &executor,
                json!({"type":"cancel_package_install","commandId":"cancel-this-install"})
            )["status"]["command"],
            command
        );
        // Then cancellation completes while the server still withholds the body,
        // cleans NamedTempFile data and retains the previous usable owner.
        let cancelled = result
            .recv_timeout(std::time::Duration::from_secs(5))
            .unwrap();
        worker.join().unwrap();
        assert_eq!(cancelled["code"], "cancelled", "{cancelled}");
        assert_eq!(
            execute(
                &executor,
                json!({"type":"package_install_status","commandId":"cancel-this-install"})
            )["status"]["phase"],
            "cancelled"
        );
        assert!(
            std::fs::read_dir(directory.path().join("plugin-blobs"))
                .unwrap()
                .all(|entry| {
                    let name = entry.unwrap().file_name().to_string_lossy().into_owned();
                    name.len() == 64 && name.bytes().all(|byte| byte.is_ascii_hexdigit())
                })
        );
        assert_eq!(
            execute(&executor, json!({"type":"snapshot"}))["snapshot"]["installedPlugins"][0]["version"],
            original.version
        );
        assert_eq!(
            execute(
                &executor,
                json!({"type":"resume_source","sourceId":source_id})
            ),
            before
        );
        assert_eq!(
            execute(&executor, json!({"type":"knowledge","keys":[key]}))["projections"][0],
            claim["projection"]
        );
        let retained = execute(
            &executor,
            json!({"type":"analyze_source","sourceId":source_id,"positionMs":0}),
        );
        assert_eq!(retained["batch"]["cues"], analyzed["batch"]["cues"]);
        assert_eq!(retained["batch"]["packageVersion"], original.version);
        drop(gate);

        // Explicit retry has a new identity; a late old cancel cannot hit it.
        let retry_gate = catalog.hold(&asset.path);
        let retry = json!({"type":"install_package","command":{"pluginId":candidate.id,"commandId":"explicit-retry"}});
        let running = executor.clone();
        let retry_request = retry.clone();
        let worker = thread::spawn(move || execute(&running, retry_request));
        retry_gate
            .entered
            .recv_timeout(std::time::Duration::from_secs(10))
            .unwrap();
        assert_eq!(
            execute(
                &executor,
                json!({"type":"cancel_package_install","commandId":"cancel-this-install"})
            )["status"],
            Value::Null
        );
        assert_eq!(
            execute(
                &executor,
                json!({"type":"package_install_status","commandId":"explicit-retry"})
            )["status"]["phase"],
            "downloading"
        );
        drop(retry_gate);
        let installed = worker.join().unwrap();
        assert_eq!(installed["type"], "installed", "{installed}");
        assert_eq!(installed["plugin"]["version"], candidate.version);
        let succeeded = execute(
            &executor,
            json!({"type":"package_install_status","commandId":"explicit-retry"}),
        );
        assert_eq!(succeeded["status"]["phase"], "succeeded", "{succeeded}");
        assert_eq!(succeeded["status"]["downloadedBytes"], total);
        assert_eq!(execute(&executor, retry), installed);
        drop(executor);
        let mut restored = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            None,
            vec![],
        )
        .unwrap();
        assert_eq!(
            call(&mut restored, json!({"type":"snapshot"}))["snapshot"]["installedPlugins"][0]["version"],
            candidate.version
        );
        assert_eq!(
            call(&mut restored, json!({"type":"knowledge","keys":[key]}))["projections"][0],
            claim["projection"]
        );
    }

    #[test]
    fn successful_install_identity_replays_original_receipt_after_another_install_and_restart() {
        let directory = tempfile::tempdir().unwrap();
        let catalog = Catalog::new();
        let (mut manifest, code, assets) = bundle("example.hello");
        catalog.publish(&manifest, &code, &assets);
        let mut runtime = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            Some(catalog.trust()),
            vec![],
        )
        .unwrap();
        let first_command = json!({"type":"install_package","command":{"pluginId":manifest.id,"commandId":"first-durable-install"}});
        let first = call(&mut runtime, first_command.clone());
        assert_eq!(first["type"], "installed", "{first}");
        manifest.version = "0.2.0-next-explicit-install".into();
        catalog.publish(&manifest, &code, &assets);
        let second = call(
            &mut runtime,
            json!({"type":"install_package","command":{"pluginId":manifest.id,"commandId":"second-durable-install"}}),
        );
        assert_eq!(second["type"], "installed", "{second}");
        drop(runtime);
        let mut runtime = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            Some(catalog.trust()),
            vec![],
        )
        .unwrap();
        // A transport replay keeps its admitted outcome, not today's catalog.
        assert_eq!(call(&mut runtime, first_command), first);
        let snapshot = call(&mut runtime, json!({"type":"snapshot"}));
        assert_eq!(
            snapshot["snapshot"]["installedPlugins"][0]["version"],
            second["plugin"]["version"]
        );
        assert_eq!(
            call(
                &mut runtime,
                json!({"type":"install_package","command":{"pluginId":"different.package","commandId":"first-durable-install"}})
            )["type"],
            "error"
        );
    }

    #[test]
    fn failed_install_identity_replays_failure_until_explicit_new_command() {
        // Given an authenticated catalog whose body fails digest validation.
        let directory = tempfile::tempdir().unwrap();
        let catalog = Catalog::new();
        let (manifest, code, assets) = bundle("example.hello");
        let mut corrupted = code.clone();
        corrupted[0] ^= 1;
        catalog.publish(&manifest, &corrupted, &assets);
        let mut runtime = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            Some(catalog.trust()),
            vec![],
        )
        .unwrap();
        let command = json!({"type":"install_package","command":{"pluginId":manifest.id,"commandId":"failed-transfer"}});
        // When a transfer fails and the server is subsequently repaired.
        let failed = call(&mut runtime, command.clone());
        assert_eq!(failed["type"], "error");
        assert_eq!(
            call(
                &mut runtime,
                json!({"type":"package_install_status","commandId":"failed-transfer"})
            )["status"]["phase"],
            "failed"
        );
        catalog.publish(&manifest, &code, &assets);
        // Then a transport replay does not secretly retry; a new command does.
        assert_eq!(call(&mut runtime, command.clone()), failed);
        assert_eq!(
            call(
                &mut runtime,
                json!({"type":"install_package","command":{"pluginId":"different.package","commandId":"failed-transfer"}})
            )["type"],
            "error"
        );
        assert_eq!(
            call(
                &mut runtime,
                json!({"type":"install_package","command":{"pluginId":manifest.id,"commandId":"new-explicit-attempt"}})
            )["type"],
            "installed"
        );
        assert_eq!(
            hello(&mut runtime)["output"]["message"],
            "Hello, still installed!"
        );
        drop(runtime);
        let mut restored = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            None,
            vec![],
        )
        .unwrap();
        assert_eq!(
            call(&mut restored, command),
            failed,
            "Failed command replay must remain explicit after another install and restart"
        );
        assert_eq!(
            hello(&mut restored)["output"]["message"],
            "Hello, still installed!"
        );
    }

    #[test]
    fn unusable_authenticated_update_preserves_installed_owner_and_restart() {
        // Given a real SDK hello package installed from a signed loopback catalog.
        let directory = tempfile::tempdir().unwrap();
        let catalog = Catalog::new();
        let (manifest, code, assets) = bundle("example.hello");
        catalog.publish(&manifest, &code, &assets);
        let mut runtime = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            Some(catalog.trust()),
            vec![],
        )
        .unwrap();
        assert_eq!(install(&mut runtime, &manifest.id)["type"], "installed");
        let expected = hello(&mut runtime);
        assert_eq!(expected["output"]["message"], "Hello, still installed!");

        // When authenticated, compilable replacements have unusable ABI/init/resources/schema.
        let mut missing_call = code.clone();
        let export = b"mlearn_call";
        let offset = missing_call
            .windows(export.len())
            .position(|w| w == export)
            .unwrap();
        missing_call[offset..offset + export.len()].copy_from_slice(b"mlearn_fail");
        CompiledPlugin::new(&missing_call, AssetMap::new()).unwrap();
        let mut missing_manifest = manifest.clone();
        missing_manifest.version = "unusable-export".into();
        missing_manifest.code = artifact(&missing_call);
        let mut initialize = manifest.clone();
        initialize.version = "unusable-initializer".into();
        initialize.execution = mlearn_language_host::ExecutionPolicy::PersistentV1;
        initialize.assets.clear();
        let (mut incompatible, japanese, _) = bundle("org.mlearn.japanese");
        incompatible.id = manifest.id.clone();
        incompatible.version = "unusable-resources".into();
        incompatible.assets = BTreeMap::from([(
            "sudachi.dic".into(),
            artifact(b"authenticated but incompatible"),
        )]);
        incompatible.resources.retain(|key, _| key == "sudachi.dic");
        let wrong_assets = BTreeMap::from([(
            "sudachi.dic".into(),
            b"authenticated but incompatible".to_vec(),
        )]);
        let mut description = manifest.clone();
        description.version = "unusable-description".into();
        description.capabilities.push("language.describe.v1".into());
        let candidates = [
            (missing_manifest, missing_call, assets.clone()),
            (initialize, code.clone(), BTreeMap::new()),
            (incompatible, japanese, wrong_assets),
            (description, code, assets),
        ];
        for (candidate, code, assets) in candidates {
            catalog.publish(&candidate, &code, &assets);
            let result = install(&mut runtime, &candidate.id);
            // Then neither the live owner nor its durable manifest is retired.
            assert_eq!(
                hello(&mut runtime),
                expected,
                "retired owner for {}: {result}",
                candidate.version
            );
            let stored =
                mlearn_storage::ProfileStore::open(&directory.path().join("profile.sqlite3"))
                    .unwrap()
                    .plugin_manifests()
                    .unwrap();
            assert_eq!(
                stored,
                vec![(
                    manifest.id.clone(),
                    serde_json::to_string(&manifest).unwrap()
                )],
                "replaced manifest for {}",
                candidate.version
            );
            assert_eq!(result["type"], "error", "{}: {result}", candidate.version);
            eprintln!(
                "READINESS_REJECT {}: {}",
                candidate.version, result["message"]
            );
            drop(runtime);
            runtime = Runtime::open(
                directory.path(),
                CodePolicy::DesktopDownloaded,
                None,
                vec![],
            )
            .unwrap();
            assert_eq!(hello(&mut runtime), expected);
            drop(runtime);
            runtime = Runtime::open(
                directory.path(),
                CodePolicy::DesktopDownloaded,
                Some(catalog.trust()),
                vec![],
            )
            .unwrap();
        }
    }

    #[test]
    fn same_version_replacement_does_not_reuse_previous_artifact_analysis() {
        // Given real English Wasm, dictionary, source and cached lexical analysis.
        let directory = tempfile::tempdir().unwrap();
        let catalog = Catalog::new();
        let (mut manifest, code, assets) = bundle("org.mlearn.english");
        catalog.publish(&manifest, &code, &assets);
        let mut runtime = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            Some(catalog.trust()),
            vec![],
        )
        .unwrap();
        assert_eq!(install(&mut runtime, &manifest.id)["type"], "installed");
        let video = directory.path().join("fixture.mp4");
        let subtitles = directory.path().join("fixture.srt");
        std::fs::write(&video, b"isolated source identity; no playback assertion").unwrap();
        std::fs::write(
            &subtitles,
            "1\n00:00:00,000 --> 00:00:10,000\nChildren walked home.\n",
        )
        .unwrap();
        let opened = call(
            &mut runtime,
            json!({"type":"open_source","path":video,"packageId":manifest.id}),
        );
        let source = &opened["window"]["source"]["id"];
        assert!(source.is_string(), "{opened}");
        assert_eq!(
            call(
                &mut runtime,
                json!({"type":"attach_subtitles","sourceId":source,"path":subtitles})
            )["type"],
            "source"
        );
        let analyze = json!({"type":"analyze_source","sourceId":source,"positionMs":0});
        let before = call(&mut runtime, analyze.clone());
        assert!(
            !before["batch"]["cues"][0]["tokens"][0]["targets"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(call(&mut runtime, analyze.clone()), before);

        // When a signed same-version module changes its lexical lookup semantics.
        // Replace only a same-length data string, preserving a real compilable SDK module.
        let mut replacement = code;
        let mut replacements = 0;
        for index in 0..replacement.len() - 6 {
            if &replacement[index..index + 6] == b"lemma/" {
                replacement[index..index + 6].copy_from_slice(b"other/");
                replacements += 1;
            }
        }
        assert!(replacements > 0);
        manifest.code = artifact(&replacement);
        catalog.publish(&manifest, &replacement, &assets);
        assert_eq!(install(&mut runtime, &manifest.id)["type"], "installed");
        let direct = call(
            &mut runtime,
            json!({"type":"invoke_plugin","pluginId":manifest.id,
            "capability":"text.analyze.v1","input":{"texts":["Children walked home."]}}),
        );
        assert!(
            direct["output"][0][0]["targets"]
                .as_array()
                .unwrap()
                .is_empty(),
            "{direct}"
        );

        // Then the existing source uses replacement output, not the prior version-only cache.
        let after = call(&mut runtime, analyze.clone());
        assert_eq!(after["type"], "analysis", "{after}");
        assert_eq!(after["batch"]["cues"][0]["tokens"], direct["output"][0]);
        assert_ne!(after["batch"]["cues"], before["batch"]["cues"]);
        drop(runtime);
        let mut runtime = Runtime::open(
            directory.path(),
            CodePolicy::DesktopDownloaded,
            None,
            vec![],
        )
        .unwrap();
        assert_eq!(call(&mut runtime, analyze), after);
    }
}

#[test]
fn signature_and_expiry_are_verified_before_accepting_catalog() {
    let key = SigningKey::from_bytes(&[42; 32]); // Test-only key, never trusted by application hosts.
    let payload = br#"{"schemaVersion":1,"expiresAt":100,"plugins":[]}"#;
    let signature = key.sign(payload);
    let envelope = serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(payload),"signature":STANDARD.encode(signature.to_bytes())})).unwrap();
    let public = STANDARD.encode(key.verifying_key().to_bytes());
    assert!(verify_catalog(&envelope, &public, 99).is_ok());
    assert!(verify_catalog(&envelope, &public, 100).is_err());
    assert!(verify_catalog(&envelope, &STANDARD.encode([3; 32]), 99).is_err());
    let changed = serde_json::to_vec(&serde_json::json!({"payload":STANDARD.encode(b"{}"),"signature":STANDARD.encode(signature.to_bytes())})).unwrap();
    assert!(verify_catalog(&changed, &public, 99).is_err());
}

#[test]
fn catalog_reopens_after_peer_closes_while_io_runtime_is_parked() {
    use mlearn_runtime::catalog::{CatalogClient, CatalogTrust};
    use std::{
        io::{Read, Write},
        net::{Shutdown, TcpListener},
        sync::mpsc,
        time::Duration,
    };
    let key = SigningKey::from_bytes(&[42; 32]);
    let payload = serde_json::to_vec(&serde_json::json!({
        "schemaVersion":1,"expiresAt":4102444800_u64,"plugins":[],
    }))
    .unwrap();
    let body = serde_json::to_vec(&serde_json::json!({
        "payload":STANDARD.encode(&payload),"signature":STANDARD.encode(key.sign(&payload).to_bytes()),
    })).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (close, close_requested) = mpsc::sync_channel(1);
    let (closed, peer_closed) = mpsc::sync_channel(1);
    let server = std::thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                assert!(request.len() < 16384);
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(&body).unwrap();
            stream.flush().unwrap();
            if index == 0 {
                close_requested
                    .recv_timeout(Duration::from_secs(5))
                    .unwrap();
                stream.shutdown(Shutdown::Both).unwrap();
                closed.send(()).unwrap();
            }
        }
    });
    let client = CatalogClient::new(CatalogTrust {
        url: format!("http://{address}/catalog.json"),
        public_key: STANDARD.encode(key.verifying_key().to_bytes()),
    })
    .unwrap();
    assert!(client.manifests().unwrap().is_empty());
    close.send(()).unwrap();
    peer_closed.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(client.manifests().unwrap().is_empty());
    server.join().unwrap();
}

#[test]
fn digest_size_and_safe_paths_are_required() {
    let bytes = b"sample";
    let mut artifact = Artifact {
        path: "objects/sample.wasm".into(),
        sha256: format!("{:x}", Sha256::digest(bytes)),
        byte_length: bytes.len(),
    };
    assert!(verify_artifact(&artifact, bytes).is_ok());
    assert!(verify_artifact(&artifact, b"tamper").is_err());
    artifact.path = "../escape".into();
    assert!(verify_artifact(&artifact, bytes).is_err());
}

#[test]
fn streamed_artifacts_reject_truncation_overflow_and_wrong_digest() {
    use mlearn_runtime::catalog::copy_artifact;
    let bytes = vec![42; 65536 * 3 + 11];
    let artifact = Artifact {
        path: "objects/data.bin".into(),
        sha256: format!("{:x}", Sha256::digest(&bytes)),
        byte_length: bytes.len(),
    };
    let mut output = Vec::new();
    copy_artifact(&artifact, &mut bytes.as_slice(), &mut output).unwrap();
    assert_eq!(output, bytes);
    assert!(
        copy_artifact(
            &artifact,
            &mut &bytes[..bytes.len() - 1],
            &mut std::io::sink()
        )
        .is_err()
    );
    let mut extra = bytes.clone();
    extra.push(0);
    assert!(copy_artifact(&artifact, &mut extra.as_slice(), &mut std::io::sink()).is_err());
    extra.pop();
    extra[1] ^= 1;
    assert!(copy_artifact(&artifact, &mut extra.as_slice(), &mut std::io::sink()).is_err());
}

#[test]
fn unknown_resource_compatibility_and_unbounded_manifest_are_rejected() {
    use mlearn_runtime::catalog::Manifest;
    let artifact =
        serde_json::json!({"path":"objects/data.bin","sha256":"a".repeat(64),"byteLength":32});
    let mut value = serde_json::json!({"id":"test.package","version":"1","abiVersion":1,"capabilities":["test"],"code":artifact,"assets":{"dict":artifact},"resources":{"dict":"bytes-v1"},"execution":"persistent-v1"});
    assert!(
        serde_json::from_value::<Manifest>(value.clone())
            .unwrap()
            .validate()
            .is_ok()
    );
    value["resources"]["dict"] = "bytes-v999".into();
    assert!(serde_json::from_value::<Manifest>(value.clone()).is_err());
    value["resources"]["dict"] = "bytes-v1".into();
    value["assets"]["dict"]["byteLength"] = (128 * 1024 * 1024 + 1).into();
    assert!(
        serde_json::from_value::<Manifest>(value)
            .unwrap()
            .validate()
            .is_err()
    );
}

#[test]
fn abi1_defaults_keep_legacy_asset_count_digest_case_and_small_budgets() {
    use mlearn_language_host::ExecutionPolicy;
    use mlearn_runtime::catalog::{Manifest, copy_artifact};
    let bytes = b"legacy";
    let artifact = serde_json::json!({"path":"objects/legacy.bin","sha256":format!("{:X}",Sha256::digest(bytes)),"byteLength":bytes.len()});
    let assets = (0..32)
        .map(|i| (format!("asset-{i}.json"), artifact.clone()))
        .collect::<serde_json::Map<_, _>>();
    let value = serde_json::json!({"id":"existing.package","version":"1","abiVersion":1,"capabilities":["existing"],"code":artifact,"assets":assets});
    let manifest: Manifest = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(manifest.execution, ExecutionPolicy::Fresh);
    assert!(manifest.resources.is_empty());
    manifest.validate().unwrap();
    verify_artifact(&manifest.code, bytes).unwrap();
    copy_artifact(&manifest.code, &mut bytes.as_slice(), &mut std::io::sink()).unwrap();
    let mut oversized = value;
    oversized["assets"]["asset-0.json"]["byteLength"] = (8 * 1024 * 1024 + 1).into();
    assert!(
        serde_json::from_value::<Manifest>(oversized)
            .unwrap()
            .validate()
            .is_err()
    );

    let mut indexed = manifest.clone();
    indexed.assets.clear();
    let mut index = manifest.code.clone();
    index.byte_length = 32 * 1024 * 1024;
    indexed
        .assets
        .insert("lexicon.sqlite".into(), index.clone());
    indexed.validate().unwrap();
    indexed
        .assets
        .get_mut("lexicon.sqlite")
        .unwrap()
        .byte_length += 1;
    assert!(indexed.validate().is_err());

    indexed.assets.clear();
    index.byte_length = 20 * 1024 * 1024;
    indexed.assets.insert("one.sqlite".into(), index.clone());
    indexed.assets.insert("two.sqlite".into(), index);
    indexed.validate().unwrap();
    indexed
        .assets
        .insert("extra.json".into(), manifest.code.clone());
    assert!(indexed.validate().is_err());
}
