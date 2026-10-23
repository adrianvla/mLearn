use super::WritingMode;
use cssparser::{
    AtRuleParser, CowRcStr, DeclarationParser, ParseError, ParseErrorKind, Parser, ParserState,
    QualifiedRuleParser, RuleBodyItemParser, RuleBodyParser,
};

#[derive(Clone, Copy)]
enum DeclarationError {
    Unrelated,
    Unsupported,
}

struct Declarations;
impl<'i> DeclarationParser<'i> for Declarations {
    type Declaration = (WritingMode, bool);
    type Error = DeclarationError;
    fn parse_value<'t>(
        &mut self,
        name: CowRcStr<'i>,
        input: &mut Parser<'i, 't>,
        _: &ParserState,
    ) -> Result<Self::Declaration, ParseError<'i, DeclarationError>> {
        if !name.eq_ignore_ascii_case("writing-mode") {
            return Err(input.new_custom_error(DeclarationError::Unrelated));
        }
        let mode = match input
            .expect_ident()
            .cloned()
            .map_err(|_| input.new_custom_error(DeclarationError::Unsupported))?
            .as_ref()
        {
            value if value.eq_ignore_ascii_case("horizontal-tb") => WritingMode::HorizontalTb,
            value if value.eq_ignore_ascii_case("vertical-rl") => WritingMode::VerticalRl,
            value if value.eq_ignore_ascii_case("vertical-lr") => WritingMode::VerticalLr,
            _ => return Err(input.new_custom_error(DeclarationError::Unsupported)),
        };
        let important = input.try_parse(cssparser::parse_important).is_ok();
        input
            .expect_exhausted()
            .map_err(|_| input.new_custom_error(DeclarationError::Unsupported))?;
        Ok((mode, important))
    }
}
impl<'i> AtRuleParser<'i> for Declarations {
    type Prelude = ();
    type AtRule = (WritingMode, bool);
    type Error = DeclarationError;
}
impl<'i> QualifiedRuleParser<'i> for Declarations {
    type Prelude = ();
    type QualifiedRule = (WritingMode, bool);
    type Error = DeclarationError;
}
impl<'i> RuleBodyItemParser<'i, (WritingMode, bool), DeclarationError> for Declarations {
    fn parse_declarations(&self) -> bool {
        true
    }
    fn parse_qualified(&self) -> bool {
        false
    }
}
pub(super) fn declarations(input: &mut Parser<'_, '_>) -> Result<Option<(WritingMode, bool)>, ()> {
    let mut chosen: Option<(WritingMode, bool)> = None;
    for value in RuleBodyParser::new(input, &mut Declarations) {
        match value {
            Ok(value) if chosen.is_none_or(|(_, important)| !important || value.1) => {
                chosen = Some(value)
            }
            Err((error, _))
                if matches!(
                    error.kind,
                    ParseErrorKind::Custom(DeclarationError::Unsupported)
                ) =>
            {
                return Err(())
            }
            Ok(_) | Err(_) => {}
        }
    }
    Ok(chosen)
}
