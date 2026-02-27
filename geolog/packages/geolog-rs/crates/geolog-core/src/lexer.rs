//! Lexer for Geolog
//!
//! Tokenizes source into a stream for the parser.
//! Supports the geolog-zeta syntax with `{ }` blocks, `|-` turnstile, etc.

use crate::span::{Pos, Span};

/// Token kinds for Geolog
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    // Identifiers
    Ident, // Alphanumeric identifier (foo, Bar, x1)

    // Keywords
    KwNamespace, // 'namespace'
    KwTheory,    // 'theory'
    KwInstance,  // 'instance'
    KwQuery,     // 'query'
    KwSort,      // 'Sort'
    KwProp,      // 'Prop'
    KwInt,       // 'Int'
    KwStr,       // 'Str'
    KwForall,    // 'forall'
    KwExists,    // 'exists'
    KwTrue,      // 'true'
    KwFalse,     // 'false'
    KwChase,     // 'chase'
    KwExtends,   // 'extends' (parsed as ident, checked contextually)

    // Punctuation
    LParen,    // (
    RParen,    // )
    LBracket,  // [
    RBracket,  // ]
    LBrace,    // {
    RBrace,    // }
    Colon,     // :
    Semicolon, // ;
    Comma,     // ,
    Dot,       // .
    Slash,     // /
    Arrow,     // ->
    Eq,        // =
    Lt,        // <
    Le,        // <=
    Gt,        // >
    Ge,        // >=
    Turnstile, // |-
    And,       // /\
    Or,        // \/
    Question,  // ?

    // Structural
    Eof,
    Error,
}

impl std::fmt::Display for Kind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Kind::Ident => write!(f, "identifier"),
            Kind::KwNamespace => write!(f, "namespace"),
            Kind::KwTheory => write!(f, "theory"),
            Kind::KwInstance => write!(f, "instance"),
            Kind::KwQuery => write!(f, "query"),
            Kind::KwSort => write!(f, "Sort"),
            Kind::KwProp => write!(f, "Prop"),
            Kind::KwInt => write!(f, "Int"),
            Kind::KwStr => write!(f, "Str"),
            Kind::KwForall => write!(f, "forall"),
            Kind::KwExists => write!(f, "exists"),
            Kind::KwTrue => write!(f, "true"),
            Kind::KwFalse => write!(f, "false"),
            Kind::KwChase => write!(f, "chase"),
            Kind::KwExtends => write!(f, "extends"),
            Kind::LParen => write!(f, "("),
            Kind::RParen => write!(f, ")"),
            Kind::LBracket => write!(f, "["),
            Kind::RBracket => write!(f, "]"),
            Kind::LBrace => write!(f, "{{"),
            Kind::RBrace => write!(f, "}}"),
            Kind::Colon => write!(f, ":"),
            Kind::Semicolon => write!(f, ";"),
            Kind::Comma => write!(f, ","),
            Kind::Dot => write!(f, "."),
            Kind::Slash => write!(f, "/"),
            Kind::Arrow => write!(f, "->"),
            Kind::Eq => write!(f, "="),
            Kind::Lt => write!(f, "<"),
            Kind::Le => write!(f, "<="),
            Kind::Gt => write!(f, ">"),
            Kind::Ge => write!(f, ">="),
            Kind::Turnstile => write!(f, "|-"),
            Kind::And => write!(f, r"/\"),
            Kind::Or => write!(f, r"\/"),
            Kind::Question => write!(f, "?"),
            Kind::Eof => write!(f, "end of file"),
            Kind::Error => write!(f, "error"),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Token {
    pub kind: Kind,
    pub text: String,
    pub span: Span,
}

impl Token {
    pub fn new(kind: Kind, text: impl Into<String>, span: Span) -> Self {
        Self {
            kind,
            text: text.into(),
            span,
        }
    }
}

fn is_ident_start(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

fn is_ident_continue(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Lexer state
pub struct Lexer<'a> {
    source: &'a str,
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Lexer<'a> {
    pub fn new(source: &'a str) -> Self {
        Self {
            source,
            bytes: source.as_bytes(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<char> {
        self.bytes.get(self.pos).map(|&b| b as char)
    }

    fn peek_next(&self) -> Option<char> {
        self.bytes.get(self.pos + 1).map(|&b| b as char)
    }

    fn advance(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.pos += 1;
        Some(c)
    }

    fn skip_whitespace_and_comments(&mut self) {
        loop {
            match self.peek() {
                Some(' ') | Some('\t') | Some('\n') | Some('\r') => {
                    self.advance();
                }
                Some('/') if self.peek_next() == Some('/') => {
                    // Line comment: skip to end of line
                    self.advance(); // /
                    self.advance(); // /
                    while let Some(c) = self.peek() {
                        if c == '\n' {
                            break;
                        }
                        self.advance();
                    }
                }
                _ => break,
            }
        }
    }

    fn scan_ident(&mut self, start: usize) -> Token {
        while let Some(c) = self.peek() {
            if is_ident_continue(c) {
                self.advance();
            } else {
                break;
            }
        }

        let text = &self.source[start..self.pos];
        let span = Span {
            start: start as Pos,
            end: self.pos as Pos,
        };

        let kind = match text {
            "namespace" => Kind::KwNamespace,
            "theory" => Kind::KwTheory,
            "instance" => Kind::KwInstance,
            "query" => Kind::KwQuery,
            "Sort" => Kind::KwSort,
            "Prop" => Kind::KwProp,
            "Int" => Kind::KwInt,
            "Str" => Kind::KwStr,
            "forall" => Kind::KwForall,
            "exists" => Kind::KwExists,
            "true" => Kind::KwTrue,
            "false" => Kind::KwFalse,
            "chase" => Kind::KwChase,
            "extends" => Kind::KwExtends,
            _ => Kind::Ident,
        };

        Token::new(kind, text, span)
    }

    pub fn next_token(&mut self) -> Token {
        self.skip_whitespace_and_comments();

        let start = self.pos;

        let Some(c) = self.advance() else {
            return Token::new(
                Kind::Eof,
                "",
                Span {
                    start: start as Pos,
                    end: start as Pos,
                },
            );
        };

        let span = |end: usize| Span {
            start: start as Pos,
            end: end as Pos,
        };

        match c {
            // Single-character tokens
            '(' => Token::new(Kind::LParen, "(", span(self.pos)),
            ')' => Token::new(Kind::RParen, ")", span(self.pos)),
            '[' => Token::new(Kind::LBracket, "[", span(self.pos)),
            ']' => Token::new(Kind::RBracket, "]", span(self.pos)),
            '{' => Token::new(Kind::LBrace, "{", span(self.pos)),
            '}' => Token::new(Kind::RBrace, "}", span(self.pos)),
            ':' => Token::new(Kind::Colon, ":", span(self.pos)),
            ';' => Token::new(Kind::Semicolon, ";", span(self.pos)),
            ',' => Token::new(Kind::Comma, ",", span(self.pos)),
            '.' => Token::new(Kind::Dot, ".", span(self.pos)),
            '?' => Token::new(Kind::Question, "?", span(self.pos)),
            '=' => Token::new(Kind::Eq, "=", span(self.pos)),

            // Comparison operators
            '<' => {
                if self.peek() == Some('=') {
                    self.advance();
                    Token::new(Kind::Le, "<=", span(self.pos))
                } else {
                    Token::new(Kind::Lt, "<", span(self.pos))
                }
            }
            '>' => {
                if self.peek() == Some('=') {
                    self.advance();
                    Token::new(Kind::Ge, ">=", span(self.pos))
                } else {
                    Token::new(Kind::Gt, ">", span(self.pos))
                }
            }

            // Multi-character tokens starting with -
            '-' if self.peek() == Some('>') => {
                self.advance();
                Token::new(Kind::Arrow, "->", span(self.pos))
            }

            // Multi-character tokens starting with |
            '|' if self.peek() == Some('-') => {
                self.advance();
                Token::new(Kind::Turnstile, "|-", span(self.pos))
            }

            // Multi-character tokens starting with /
            '/' => match self.peek() {
                Some('\\') => {
                    self.advance();
                    Token::new(Kind::And, r"/\", span(self.pos))
                }
                _ => Token::new(Kind::Slash, "/", span(self.pos)),
            },

            // Multi-character tokens starting with \
            '\\' if self.peek() == Some('/') => {
                self.advance();
                Token::new(Kind::Or, r"\/", span(self.pos))
            }

            // Identifiers
            c if is_ident_start(c) => self.scan_ident(start),

            // Unknown
            _ => Token::new(Kind::Error, &self.source[start..self.pos], span(self.pos)),
        }
    }
}

/// Lex a source string into tokens
pub fn lex(source: &str) -> Vec<Token> {
    let mut lexer = Lexer::new(source);
    let mut tokens = Vec::new();

    loop {
        let tok = lexer.next_token();
        let is_eof = tok.kind == Kind::Eof;
        tokens.push(tok);
        if is_eof {
            break;
        }
    }

    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lex_kinds(source: &str) -> Vec<Kind> {
        lex(source).into_iter().map(|t| t.kind).collect()
    }

    #[test]
    fn test_keywords() {
        assert_eq!(
            lex_kinds("theory instance query namespace"),
            vec![
                Kind::KwTheory,
                Kind::KwInstance,
                Kind::KwQuery,
                Kind::KwNamespace,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_type_keywords() {
        assert_eq!(
            lex_kinds("Sort Prop Int Str"),
            vec![
                Kind::KwSort,
                Kind::KwProp,
                Kind::KwInt,
                Kind::KwStr,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_comparison_operators() {
        assert_eq!(
            lex_kinds("< <= > >="),
            vec![Kind::Lt, Kind::Le, Kind::Gt, Kind::Ge, Kind::Eof]
        );
    }

    #[test]
    fn test_logic_keywords() {
        assert_eq!(
            lex_kinds("forall exists true false"),
            vec![
                Kind::KwForall,
                Kind::KwExists,
                Kind::KwTrue,
                Kind::KwFalse,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_punctuation() {
        assert_eq!(
            lex_kinds("( ) [ ] { } : ; , . / = ?"),
            vec![
                Kind::LParen,
                Kind::RParen,
                Kind::LBracket,
                Kind::RBracket,
                Kind::LBrace,
                Kind::RBrace,
                Kind::Colon,
                Kind::Semicolon,
                Kind::Comma,
                Kind::Dot,
                Kind::Slash,
                Kind::Eq,
                Kind::Question,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_multi_char_tokens() {
        assert_eq!(
            lex_kinds("-> |- /\\ \\/"),
            vec![Kind::Arrow, Kind::Turnstile, Kind::And, Kind::Or, Kind::Eof]
        );
    }

    #[test]
    fn test_identifiers() {
        let tokens = lex("foo Bar x1 _test");
        assert_eq!(tokens[0].kind, Kind::Ident);
        assert_eq!(tokens[0].text, "foo");
        assert_eq!(tokens[1].kind, Kind::Ident);
        assert_eq!(tokens[1].text, "Bar");
        assert_eq!(tokens[2].kind, Kind::Ident);
        assert_eq!(tokens[2].text, "x1");
        assert_eq!(tokens[3].kind, Kind::Ident);
        assert_eq!(tokens[3].text, "_test");
    }

    #[test]
    fn test_line_comment() {
        assert_eq!(
            lex_kinds("foo // this is a comment\nbar"),
            vec![Kind::Ident, Kind::Ident, Kind::Eof]
        );
    }

    #[test]
    fn test_theory_syntax() {
        let tokens = lex("theory Graph { V : Sort; }");
        assert_eq!(
            tokens.iter().map(|t| t.kind).collect::<Vec<_>>(),
            vec![
                Kind::KwTheory,
                Kind::Ident,
                Kind::LBrace,
                Kind::Ident,
                Kind::Colon,
                Kind::KwSort,
                Kind::Semicolon,
                Kind::RBrace,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_axiom_syntax() {
        let tokens = lex("ax : forall x : V. |- x = x;");
        assert_eq!(
            tokens.iter().map(|t| t.kind).collect::<Vec<_>>(),
            vec![
                Kind::Ident,
                Kind::Colon,
                Kind::KwForall,
                Kind::Ident,
                Kind::Colon,
                Kind::Ident,
                Kind::Dot,
                Kind::Turnstile,
                Kind::Ident,
                Kind::Eq,
                Kind::Ident,
                Kind::Semicolon,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_record_syntax() {
        let tokens = lex("[x: M, y: M]");
        assert_eq!(
            tokens.iter().map(|t| t.kind).collect::<Vec<_>>(),
            vec![
                Kind::LBracket,
                Kind::Ident,
                Kind::Colon,
                Kind::Ident,
                Kind::Comma,
                Kind::Ident,
                Kind::Colon,
                Kind::Ident,
                Kind::RBracket,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_path_with_slash() {
        // In geolog-zeta, `in/src` is parsed as three tokens: in, /, src
        // The parser combines them into a Path
        let tokens = lex("in/src");
        assert_eq!(
            tokens.iter().map(|t| t.kind).collect::<Vec<_>>(),
            vec![Kind::Ident, Kind::Slash, Kind::Ident, Kind::Eof]
        );
    }

    #[test]
    fn test_formula_connectives() {
        let tokens = lex("P /\\ Q \\/ R");
        assert_eq!(
            tokens.iter().map(|t| t.kind).collect::<Vec<_>>(),
            vec![
                Kind::Ident,
                Kind::And,
                Kind::Ident,
                Kind::Or,
                Kind::Ident,
                Kind::Eof
            ]
        );
    }
}
