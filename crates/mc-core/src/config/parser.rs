use nom::{
    branch::alt,
    bytes::complete::{take_while, take_while1},
    character::complete::{char, line_ending, space0},
    combinator::opt,
    multi::many0,
    IResult,
};
use std::collections::BTreeMap;

/// A parsed config file preserving comments and ordering
#[derive(Debug, Clone)]
pub struct ConfigFile {
    pub entries: Vec<ConfigLine>,
}

#[derive(Debug, Clone)]
pub enum ConfigLine {
    /// A key = value pair
    KeyValue { key: String, value: String },
    /// A comment line (including the # prefix)
    Comment(String),
    /// An empty/blank line
    Blank,
}

impl ConfigFile {
    pub fn get(&self, key: &str) -> Option<&str> {
        for line in &self.entries {
            if let ConfigLine::KeyValue { key: k, value: v } = line {
                if k == key {
                    return Some(v.as_str());
                }
            }
        }
        None
    }

    pub fn set(&mut self, key: &str, new_value: &str) {
        let mut found = false;
        for line in &mut self.entries {
            if let ConfigLine::KeyValue { key: k, value: v } = line {
                if k == key {
                    *v = new_value.to_string();
                    found = true;
                    break;
                }
            }
        }
        if !found {
            self.entries.push(ConfigLine::KeyValue {
                key: key.to_string(),
                value: new_value.to_string(),
            });
        }
    }

    pub fn remove(&mut self, key: &str) {
        self.entries.retain(|line| {
            if let ConfigLine::KeyValue { key: k, .. } = line {
                k != key
            } else {
                true
            }
        });
    }

    pub fn serialize(&self) -> String {
        let mut output = String::new();
        for line in &self.entries {
            match line {
                ConfigLine::KeyValue { key, value } => {
                    output.push_str(&format!("{} = {}\n", key, value));
                }
                ConfigLine::Comment(c) => {
                    output.push_str(c);
                    output.push('\n');
                }
                ConfigLine::Blank => {
                    output.push('\n');
                }
            }
        }
        output
    }

    pub fn to_map(&self) -> BTreeMap<String, String> {
        let mut map = BTreeMap::new();
        for line in &self.entries {
            if let ConfigLine::KeyValue { key, value } = line {
                map.insert(key.clone(), value.clone());
            }
        }
        map
    }

    /// Return all values for a given key (for keys that appear multiple times).
    pub fn get_all(&self, key: &str) -> Vec<&str> {
        self.entries
            .iter()
            .filter_map(|line| {
                if let ConfigLine::KeyValue { key: k, value: v } = line {
                    if k == key {
                        return Some(v.as_str());
                    }
                }
                None
            })
            .collect()
    }
}

// nom parsers

fn is_not_newline(c: char) -> bool {
    c != '\n' && c != '\r'
}

fn comment_line(input: &str) -> IResult<&str, ConfigLine> {
    let (input, _) = space0(input)?;
    let (input, _) = char('#')(input)?;
    let (input, rest) = take_while(is_not_newline)(input)?;
    let (input, _) = opt(line_ending)(input)?;
    Ok((input, ConfigLine::Comment(format!("#{}", rest))))
}

fn blank_line(input: &str) -> IResult<&str, ConfigLine> {
    let (input, _) = space0(input)?;
    let (input, _) = line_ending(input)?;
    Ok((input, ConfigLine::Blank))
}

fn key_chars(input: &str) -> IResult<&str, &str> {
    take_while1(|c: char| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')(input)
}

fn key_value_line(input: &str) -> IResult<&str, ConfigLine> {
    let (input, _) = space0(input)?;
    let (input, key) = key_chars(input)?;
    let (input, _) = space0(input)?;
    let (input, _) = char('=')(input)?;
    let (input, _) = space0(input)?;
    let (input, val) = take_while(is_not_newline)(input)?;
    let (input, _) = opt(line_ending)(input)?;
    Ok((
        input,
        ConfigLine::KeyValue {
            key: key.to_string(),
            value: val.trim_end().to_string(),
        },
    ))
}

fn config_line(input: &str) -> IResult<&str, ConfigLine> {
    alt((comment_line, blank_line, key_value_line))(input)
}

pub fn parse_config(input: &str) -> Result<ConfigFile, String> {
    let (remaining, entries) =
        many0(config_line)(input).map_err(|e| format!("Parse error: {}", e))?;

    // Handle any remaining non-empty content
    if !remaining.trim().is_empty() {
        return Err(format!(
            "Unparsed content remaining: {:?}",
            &remaining[..remaining.len().min(100)]
        ));
    }

    Ok(ConfigFile { entries })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_config() {
        let input =
            "# This is a comment\nmyhostname = mail.example.com\nmydomain = example.com\n";
        let config = parse_config(input).unwrap();
        assert_eq!(config.get("myhostname"), Some("mail.example.com"));
        assert_eq!(config.get("mydomain"), Some("example.com"));
    }

    #[test]
    fn test_roundtrip() {
        let input = "# Comment\nkey1 = value1\n\nkey2 = value2\n";
        let config = parse_config(input).unwrap();
        let output = config.serialize();
        let config2 = parse_config(&output).unwrap();
        assert_eq!(config2.get("key1"), Some("value1"));
        assert_eq!(config2.get("key2"), Some("value2"));
    }

    #[test]
    fn test_set_existing_key() {
        let input = "key1 = old_value\n";
        let mut config = parse_config(input).unwrap();
        config.set("key1", "new_value");
        assert_eq!(config.get("key1"), Some("new_value"));
    }

    #[test]
    fn test_set_new_key() {
        let input = "key1 = value1\n";
        let mut config = parse_config(input).unwrap();
        config.set("key2", "value2");
        assert_eq!(config.get("key2"), Some("value2"));
    }

    #[test]
    fn test_remove_key() {
        let input = "key1 = value1\nkey2 = value2\n";
        let mut config = parse_config(input).unwrap();
        config.remove("key1");
        assert_eq!(config.get("key1"), None);
        assert_eq!(config.get("key2"), Some("value2"));
    }

    #[test]
    fn test_to_map() {
        let input = "key1 = value1\nkey2 = value2\n";
        let config = parse_config(input).unwrap();
        let map = config.to_map();
        assert_eq!(map.get("key1").map(|s| s.as_str()), Some("value1"));
        assert_eq!(map.get("key2").map(|s| s.as_str()), Some("value2"));
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn test_blank_lines_preserved() {
        let input = "key1 = value1\n\n\nkey2 = value2\n";
        let config = parse_config(input).unwrap();
        let output = config.serialize();
        assert_eq!(output, input);
    }

    #[test]
    fn test_comment_preserved() {
        let input = "# My comment\nkey1 = value1\n";
        let config = parse_config(input).unwrap();
        let output = config.serialize();
        assert_eq!(output, input);
    }

    #[test]
    fn test_get_all() {
        let input = "key1 = value1\nkey1 = value2\n";
        let config = parse_config(input).unwrap();
        let all = config.get_all("key1");
        assert_eq!(all, vec!["value1", "value2"]);
    }

    #[test]
    fn test_empty_input() {
        let config = parse_config("").unwrap();
        assert!(config.entries.is_empty());
    }

    #[test]
    fn test_value_with_equals() {
        let input = "key1 = value=with=equals\n";
        let config = parse_config(input).unwrap();
        assert_eq!(config.get("key1"), Some("value=with=equals"));
    }

    #[test]
    fn test_key_with_dots_and_dashes() {
        let input = "smtpd_tls.cert_file = /etc/ssl/cert.pem\nmy-key = my-value\n";
        let config = parse_config(input).unwrap();
        assert_eq!(
            config.get("smtpd_tls.cert_file"),
            Some("/etc/ssl/cert.pem")
        );
        assert_eq!(config.get("my-key"), Some("my-value"));
    }
}
