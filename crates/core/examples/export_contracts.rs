#[cfg(feature = "typescript")]
fn main() {
    use mlearn_core::*;
    use ts_rs::TS;
    let declarations = [OccurrenceKnowledge::decl(),SourceRecord::decl(),Cue::decl(),SourceWindow::decl(),Capability::decl(),LanguageDescription::decl(),AnalyzedToken::decl(),CueAnalysis::decl(),AnalysisBatch::decl(),LexicalSense::decl(),LexicalEntry::decl(),KnowledgeKey::decl(),KnowledgeProjection::decl(),ClaimChange::decl(),ThemeColors::decl(), ThemeDocument::decl(), PluginSummary::decl(), Snapshot::decl(), Request::decl(), Response::decl()];
    let output = format!("// Generated from mlearn-core. Run npm run codegen; do not edit.\n\n{}\n", declarations.into_iter().map(|d| format!("export {d}")).collect::<Vec<_>>().join("\n\n"));
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/contracts/src/generated.ts");
    if std::env::args().any(|a| a == "--check") {
        assert_eq!(std::fs::read_to_string(&path).expect("generated contracts missing"), output, "Generated contracts are stale");
    } else {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, output).unwrap();
    }
}
#[cfg(not(feature = "typescript"))]
fn main() { panic!("Enable the typescript feature for code generation"); }
