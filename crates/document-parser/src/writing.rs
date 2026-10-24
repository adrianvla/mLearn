//! Authored writing-mode only. This is not a CSS layout or browser style engine.
use super::*;
mod declarations;
use cssparser::{
    AtRuleParser, ParseError, ParseErrorKind, Parser, ParserInput, ParserState,
    QualifiedRuleParser, StyleSheetParser, Token,
};
use declarations::declarations;
use xml::Node;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WritingMode {
    HorizontalTb,
    VerticalRl,
    VerticalLr,
}

#[derive(Default)]
pub(super) struct Styles {
    rules: Vec<Rule>,
}
struct Rule {
    selector: Selector,
    mode: WritingMode,
    important: bool,
}
#[derive(Default)]
struct Selector {
    tag: Option<String>,
    ids: Vec<String>,
    classes: Vec<String>,
}
impl Selector {
    fn matches(&self, node: &Node) -> bool {
        self.tag.as_ref().is_none_or(|tag| node.name == *tag)
            && self.ids.iter().all(|id| node.attrs.get("id") == Some(id))
            && self.classes.iter().all(|class| {
                node.attrs
                    .get("class")
                    .is_some_and(|value| value.split_whitespace().any(|value| value == class))
            })
    }
    fn specificity(&self) -> (usize, usize, usize) {
        (
            self.ids.len(),
            self.classes.len(),
            usize::from(self.tag.is_some()),
        )
    }
}
fn selector(input: &mut Parser<'_, '_>) -> Option<Selector> {
    let mut value = Selector::default();
    while let Ok(token) = input.next_including_whitespace().cloned() {
        if value.ids.len().saturating_add(value.classes.len()) > 16 {
            return None;
        }
        match token {
            Token::Ident(tag) if value.tag.is_none() => value.tag = Some(tag.to_string()),
            Token::Delim('*') if value.tag.is_none() => {}
            Token::IDHash(id) => value.ids.push(id.to_string()),
            Token::Delim('.') => value.classes.push(input.expect_ident().ok()?.to_string()),
            Token::WhiteSpace(_) if input.is_exhausted() => {}
            _ => return None,
        }
    }
    Some(value)
}
struct Rules;
impl<'i> AtRuleParser<'i> for Rules {
    type Prelude = ();
    type AtRule = Vec<Rule>;
    type Error = ();
}
impl<'i> QualifiedRuleParser<'i> for Rules {
    type Prelude = Option<Vec<Selector>>;
    type QualifiedRule = Vec<Rule>;
    type Error = ();
    fn parse_prelude<'t>(
        &mut self,
        input: &mut Parser<'i, 't>,
    ) -> Result<Self::Prelude, ParseError<'i, ()>> {
        // A complex selector is rejected only if its rule actually owns writing-mode.
        Ok(input
            .parse_comma_separated(|input| {
                selector(input).ok_or_else(|| input.new_custom_error::<(), ()>(()))
            })
            .ok())
    }
    fn parse_block<'t>(
        &mut self,
        prelude: Self::Prelude,
        _: &ParserState,
        input: &mut Parser<'i, 't>,
    ) -> Result<Vec<Rule>, ParseError<'i, ()>> {
        match declarations(input).map_err(|_| input.new_custom_error(()))? {
            None => Ok(Vec::new()),
            Some((mode, important)) => Ok(prelude
                .ok_or_else(|| input.new_custom_error(()))?
                .into_iter()
                .map(|selector| Rule {
                    selector,
                    mode,
                    important,
                })
                .collect()),
        }
    }
}
impl Styles {
    pub(super) fn read(
        chapter: &Node,
        resource: &str,
        archive: &archive::Archive,
    ) -> Result<Self, Error> {
        let mut styles = Self::default();
        let mut source_bytes = 0usize;
        let mut sheets = 0usize;
        for node in chapter.descendants("*") {
            let source = match node.name.as_str() {
                "link"
                    if node.attrs.get("rel").is_some_and(|rel| {
                        rel.split_whitespace().any(|value| value == "stylesheet")
                    }) =>
                {
                    let path = archive::resolve(resource, node.attr("href")?)?;
                    Some(archive.text(&path)?.to_owned())
                }
                "style" => Some(node.text()),
                _ => None,
            };
            if let Some(source) = source {
                sheets = sheets.saturating_add(1);
                source_bytes = source_bytes.saturating_add(source.len());
                check(sheets, 32, "CSS stylesheets")?;
                check(
                    source_bytes,
                    Limits::default().entry_bytes,
                    "CSS source bytes",
                )?;
                let mut input = ParserInput::new(&source);
                for rule in StyleSheetParser::new(&mut Parser::new(&mut input), &mut Rules) {
                    match rule {
                        Ok(rules) => {
                            check(
                                styles.rules.len().saturating_add(rules.len()),
                                128,
                                "writing-mode rules",
                            )?;
                            styles.rules.extend(rules);
                        }
                        Err((_, text))
                            if text
                                .trim_start()
                                .to_ascii_lowercase()
                                .starts_with("@import") =>
                        {
                            return Err(Error::Unsupported("CSS stylesheet imports"));
                        }
                        Err((error, text))
                            if matches!(error.kind, ParseErrorKind::Custom(()))
                                || text.to_ascii_lowercase().contains("writing-mode") =>
                        {
                            return Err(Error::Unsupported("complex CSS writing-mode rule"))
                        }
                        Err(_) => {}
                    }
                }
            }
        }
        Ok(styles)
    }
    pub(super) fn mode(
        &self,
        node: &Node,
        inherited: Option<WritingMode>,
    ) -> Result<Option<WritingMode>, Error> {
        let chosen = self
            .rules
            .iter()
            .enumerate()
            .filter(|(_, rule)| rule.selector.matches(node))
            .max_by_key(|(index, rule)| (rule.important, rule.selector.specificity(), *index))
            .map(|(_, rule)| (rule.mode, rule.important));
        let inline = match node.attrs.get("style") {
            Some(text) => {
                let mut input = ParserInput::new(text);
                declarations(&mut Parser::new(&mut input))
                    .map_err(|_| Error::Unsupported("writing-mode declaration"))?
            }
            None => None,
        };
        Ok(match (chosen, inline) {
            (Some((mode, true)), Some((_, false))) => Some(mode),
            (_, Some((mode, _))) | (Some((mode, _)), None) => Some(mode),
            (None, None) => inherited,
        })
    }
}
