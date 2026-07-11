use std::collections::HashMap;

const REDACTED: &str = "[REDACTED]";
const COMPACT_SENSITIVE_KEYS: [&str; 10] = [
    "APIKEY",
    "ACCESSTOKEN",
    "REFRESHTOKEN",
    "CLIENTSECRET",
    "PRIVATEKEY",
    "SESSIONID",
    "AUTHHEADER",
    "DATABASEURL",
    "DBURL",
    "AUTHORIZATION",
];
const SENSITIVE_KEY_PATTERNS: [&str; 20] = [
    "KEY",
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASS",
    "JWT",
    "DATABASE_URL",
    "DB_URL",
    "PRIVATE",
    "COOKIE",
    "SESSION",
    "AUTH",
    "AUTHORIZATION",
    "OPENAI",
    "ANTHROPIC",
    "DEEPSEEK",
    "SUPABASE",
    "MODAL",
    "CLOUDFLARE",
    "R2",
];

pub fn is_sensitive_key(key: &str) -> bool {
    let upper_key = key.to_ascii_uppercase();
    let compact: String = upper_key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .collect();
    if COMPACT_SENSITIVE_KEYS.contains(&compact.as_str()) {
        return true;
    }
    let segments = key_segments(key);
    SENSITIVE_KEY_PATTERNS.iter().any(|pattern| {
        let pattern_segments: Vec<String> = pattern.split('_').map(str::to_string).collect();
        segments
            .windows(pattern_segments.len())
            .any(|window| window == pattern_segments)
    })
}

fn key_segments(key: &str) -> Vec<String> {
    let characters: Vec<char> = key.chars().collect();
    let mut segments = Vec::new();
    let mut current = String::new();
    for (index, character) in characters.iter().copied().enumerate() {
        if !character.is_ascii_alphanumeric() {
            if !current.is_empty() {
                segments.push(std::mem::take(&mut current).to_ascii_uppercase());
            }
            continue;
        }
        let previous = index
            .checked_sub(1)
            .and_then(|i| characters.get(i))
            .copied();
        let next = characters.get(index + 1).copied();
        let camel_boundary = character.is_ascii_uppercase()
            && !current.is_empty()
            && (previous.is_some_and(|value| value.is_ascii_lowercase() || value.is_ascii_digit())
                || (previous.is_some_and(|value| value.is_ascii_uppercase())
                    && next.is_some_and(|value| value.is_ascii_lowercase())));
        if camel_boundary {
            segments.push(std::mem::take(&mut current).to_ascii_uppercase());
        }
        current.push(character);
    }
    if !current.is_empty() {
        segments.push(current.to_ascii_uppercase());
    }
    segments
}

pub fn looks_like_secret(value: &str) -> bool {
    find_secret_range(value, 0).is_some()
}

pub fn redact_value(key: &str, value: &str) -> String {
    if is_sensitive_key(key) || looks_like_secret(value) {
        REDACTED.to_string()
    } else {
        value.to_string()
    }
}

pub fn redact_map(map: &HashMap<String, String>) -> HashMap<String, String> {
    map.iter()
        .map(|(key, value)| (key.clone(), redact_value(key, value)))
        .collect()
}

pub fn redact_line(line: &str) -> String {
    let key_redacted = redact_sensitive_assignments(line);
    redact_secret_ranges(&key_redacted)
}

fn redact_sensitive_assignments(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let mut start = 0;

    for segment in line.split_inclusive(char::is_whitespace) {
        let trimmed_len = segment.trim_end_matches(char::is_whitespace).len();
        let (token, trailing) = segment.split_at(trimmed_len);
        result.push_str(&redact_assignment_token(token));
        result.push_str(trailing);
        start += segment.len();
    }

    if start < line.len() {
        result.push_str(&redact_assignment_token(&line[start..]));
    }

    result
}

fn redact_assignment_token(token: &str) -> String {
    let Some(separator_index) = token.find('=') else {
        return token.to_string();
    };
    let key = token[..separator_index].trim_matches(|character: char| !is_key_character(character));

    if is_sensitive_key(key) && &token[separator_index + 1..] != "Bearer" {
        format!("{}={}", &token[..separator_index], REDACTED)
    } else {
        token.to_string()
    }
}

fn redact_secret_ranges(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let mut cursor = 0;

    while let Some((start, end)) = find_secret_range(line, cursor) {
        result.push_str(&line[cursor..start]);
        result.push_str(REDACTED);
        cursor = end;
    }

    result.push_str(&line[cursor..]);
    result
}

fn find_secret_range(value: &str, from: usize) -> Option<(usize, usize)> {
    let candidates = [
        find_openai_key(value, from),
        find_aws_key(value, from),
        find_bearer_token(value, from),
        find_jwt(value, from),
        find_database_url(value, from),
        find_long_hex(value, from),
        find_long_base64(value, from),
    ];

    candidates
        .into_iter()
        .flatten()
        .min_by_key(|(start, _)| *start)
}

fn find_openai_key(value: &str, from: usize) -> Option<(usize, usize)> {
    for (index, _) in value.char_indices().skip_while(|(index, _)| *index < from) {
        let rest = &value[index..];
        if let Some(secret) = rest.strip_prefix("sk-") {
            let secret_len = take_while_len(secret, |character| character.is_ascii_alphanumeric());
            if secret_len >= 20 {
                return Some((index, index + 3 + secret_len));
            }
        }
    }
    None
}

fn find_aws_key(value: &str, from: usize) -> Option<(usize, usize)> {
    for (index, _) in value.char_indices().skip_while(|(index, _)| *index < from) {
        let rest = &value[index..];
        if let Some(secret) = rest.strip_prefix("AKIA") {
            let secret_len = take_while_len(secret, |character| {
                character.is_ascii_uppercase() || character.is_ascii_digit()
            });
            if secret_len >= 16 {
                return Some((index, index + 4 + 16));
            }
        }
    }
    None
}

fn find_bearer_token(value: &str, from: usize) -> Option<(usize, usize)> {
    let mut search_from = from;

    while search_from < value.len() {
        let Some(relative_index) = value[search_from..].find("Bearer ") else {
            return None;
        };
        let start = search_from + relative_index;
        let token_start = start + "Bearer ".len();
        let token_len = take_while_len(&value[token_start..], |character| {
            !character.is_whitespace()
        });

        if token_len > 0 {
            return Some((start, token_start + token_len));
        }

        search_from = token_start;
    }

    None
}

fn find_jwt(value: &str, from: usize) -> Option<(usize, usize)> {
    for (index, _) in value.char_indices().skip_while(|(index, _)| *index < from) {
        let rest = &value[index..];
        if !rest.starts_with("eyJ") {
            continue;
        }

        let token_len = take_while_len(rest, is_jwt_character);
        let token = &rest[..token_len];
        if token.split('.').count() == 3 && token.split('.').all(|segment| !segment.is_empty()) {
            return Some((index, index + token_len));
        }
    }

    None
}

fn find_database_url(value: &str, from: usize) -> Option<(usize, usize)> {
    ["postgres://", "mysql://", "mongodb://"]
        .into_iter()
        .filter_map(|scheme| find_database_url_for_scheme(value, from, scheme))
        .min_by_key(|(start, _)| *start)
}

fn find_database_url_for_scheme(value: &str, from: usize, scheme: &str) -> Option<(usize, usize)> {
    let mut search_from = from;

    while search_from < value.len() {
        let Some(relative_index) = value[search_from..].find(scheme) else {
            return None;
        };
        let start = search_from + relative_index;
        let credentials_start = start + scheme.len();
        let url_len = take_while_len(&value[start..], |character| !character.is_whitespace());
        let url = &value[credentials_start..start + url_len];

        if let Some(at_index) = url.find('@') {
            if url[..at_index].contains(':') {
                return Some((start, start + url_len));
            }
        }

        search_from = credentials_start;
    }

    None
}

fn find_long_hex(value: &str, from: usize) -> Option<(usize, usize)> {
    find_long_run(value, from, 32, |character| character.is_ascii_hexdigit())
}

fn find_long_base64(value: &str, from: usize) -> Option<(usize, usize)> {
    find_long_run(value, from, 40, is_base64_character)
}

fn find_long_run(
    value: &str,
    from: usize,
    minimum_characters: usize,
    predicate: impl Fn(char) -> bool,
) -> Option<(usize, usize)> {
    let mut run_start: Option<usize> = None;
    let mut run_characters = 0;

    for (index, character) in value.char_indices().skip_while(|(index, _)| *index < from) {
        if predicate(character) {
            if run_start.is_none() {
                run_start = Some(index);
            }
            run_characters += 1;
        } else if let Some(start) = run_start {
            if run_characters >= minimum_characters {
                return Some((start, index));
            }
            run_start = None;
            run_characters = 0;
        }
    }

    if let Some(start) = run_start {
        if run_characters >= minimum_characters {
            return Some((start, value.len()));
        }
    }

    None
}

fn take_while_len(value: &str, predicate: impl Fn(char) -> bool) -> usize {
    value
        .char_indices()
        .find(|(_, character)| !predicate(*character))
        .map_or(value.len(), |(index, _)| index)
}

fn is_key_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

fn is_jwt_character(character: char) -> bool {
    character.is_ascii_alphanumeric()
        || character == '+'
        || character == '/'
        || character == '='
        || character == '-'
        || character == '_'
        || character == '.'
}

fn is_base64_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '+' || character == '/' || character == '='
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn detects_every_sensitive_key_pattern() {
        let keys = [
            "API_KEY",
            "ACCESS_TOKEN",
            "CLIENT_SECRET",
            "PASSWORD",
            "PASS",
            "JWT",
            "DATABASE_URL",
            "DB_URL",
            "PRIVATE_KEY",
            "COOKIE",
            "SESSION_ID",
            "AUTH_HEADER",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "DEEPSEEK_API_KEY",
            "SUPABASE_URL",
            "MODAL_TOKEN",
            "CLOUDFLARE_API_TOKEN",
            "R2_ACCESS_KEY_ID",
        ];

        for key in keys {
            assert!(is_sensitive_key(key), "{key} should be sensitive");
        }
    }

    #[test]
    fn leaves_non_sensitive_keys_unflagged() {
        for key in [
            "PORT",
            "NAME",
            "HOST",
            "DEBUG",
            "MONKEY_ID",
            "COMPASS_GROUP",
        ] {
            assert!(!is_sensitive_key(key), "{key} should not be sensitive");
        }
    }

    #[test]
    fn detects_sensitive_keys_case_insensitively() {
        assert!(is_sensitive_key("api_key"));
        assert!(is_sensitive_key("API_KEY"));
        assert!(is_sensitive_key("Api_Key"));
    }

    #[test]
    fn detects_camel_case_and_compact_credential_keys_without_substring_false_positives() {
        for key in [
            "apiKey",
            "apikey",
            "accessToken",
            "refreshToken",
            "clientSecret",
            "privateKey",
            "sessionId",
            "authHeader",
            "api-key",
            "ACCESS_TOKEN",
        ] {
            assert!(is_sensitive_key(key), "{key} should be sensitive");
        }
        for key in ["monkey_id", "compass_group", "hockeyTeam", "bypassMode"] {
            assert!(!is_sensitive_key(key), "{key} should remain visible");
        }
    }

    #[test]
    fn detects_secret_value_patterns() {
        let values = [
            "sk-abcdefghijklmnopqrstuvwxyz1234567890",
            "AKIAABCDEFGHIJKLMNOP",
            "Bearer abc.def.ghi",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
            "postgres://user:pass@example.com:5432/db",
            "mysql://user:pass@example.com/db",
            "mongodb://user:pass@example.com/db",
            "0123456789abcdef0123456789abcdef",
            "QWxhZGRpbjpvcGVuIHNlc2FtZSBleHRyYSBsb25nIGJhc2U2NCB2YWx1ZQ==",
        ];

        for value in values {
            assert!(looks_like_secret(value), "{value} should look secret");
        }
    }

    #[test]
    fn leaves_non_secret_values_unflagged() {
        for value in [
            "3000",
            "localhost",
            "true",
            "hello",
            "sk-short",
            "AKIASHORT",
        ] {
            assert!(!looks_like_secret(value), "{value} should not look secret");
        }
    }

    #[test]
    fn redacts_sensitive_key_values() {
        assert_eq!(redact_value("API_KEY", "sk-secret123"), "[REDACTED]");
    }

    #[test]
    fn preserves_non_sensitive_normal_values() {
        assert_eq!(redact_value("PORT", "3000"), "3000");
    }

    #[test]
    fn redacts_secret_like_values_for_non_sensitive_keys() {
        assert_eq!(
            redact_value("NAME", "sk-abcdefghijklmnopqrstuvwxyz1234567890"),
            "[REDACTED]"
        );
    }

    #[test]
    fn redacts_maps_entry_by_entry() {
        let mut map = HashMap::new();
        map.insert("PORT".to_string(), "3000".to_string());
        map.insert("API_KEY".to_string(), "secret".to_string());
        map.insert(
            "NAME".to_string(),
            "sk-abcdefghijklmnopqrstuvwxyz1234567890".to_string(),
        );

        let redacted = redact_map(&map);

        assert_eq!(redacted.get("PORT").unwrap(), "3000");
        assert_eq!(redacted.get("API_KEY").unwrap(), "[REDACTED]");
        assert_eq!(redacted.get("NAME").unwrap(), "[REDACTED]");
    }

    #[test]
    fn redacts_secret_patterns_inline_and_preserves_other_text() {
        let line = "port=3000 token=sk-abcdefghijklmnopqrstuvwxyz1234567890 host=localhost auth=Bearer abc.def";

        assert_eq!(
            redact_line(line),
            "port=3000 token=[REDACTED] host=localhost auth=[REDACTED]"
        );
    }

    #[test]
    fn redacts_database_credentials_inline() {
        let line = "DATABASE_URL=postgres://user:pass@localhost:5432/mlearn ready=true";

        assert_eq!(redact_line(line), "DATABASE_URL=[REDACTED] ready=true");
    }
}
