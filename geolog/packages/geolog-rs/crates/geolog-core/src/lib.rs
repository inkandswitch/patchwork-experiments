pub mod ast;
pub mod core;
pub mod database;
pub mod diagnostic;
pub mod elaborate;
pub mod lexer;
pub mod opdag;
pub mod parser;
pub mod span;
pub mod structure;

// Re-export main types for convenience
pub use ast::{Declaration, File as AstFile, InstanceDecl, Path, TheoryDecl};
pub use diagnostic::{Diagnostic, File, Severity};
pub use lexer::{lex, Kind, Token};
pub use parser::{parse, ParseResult, Parser};
pub use span::{Pos, Span};

// Core types
pub use core::{
    BindingKind, Context, DerivedSort, ElaboratedTheory, Formula, FuncId, FunctionSymbol,
    InstanceFieldId, RelId, RelationSymbol, Sequent, Signature, SortId, Term, Theory, TheoryParam,
};
pub use structure::{ElementId, FunctionData, RelationData, Structure};

// Database types
pub use database::{Database, DbError};
pub use opdag::{DagOp, EntityId, Op, OpDag, OpId, OpPatch, Value};

// Tests for the new lexer and parser
#[cfg(test)]
mod tests {
    use super::*;

    // Basic lexer tests for new token types
    #[test]
    fn test_lexer_delimiters() {
        let tokens = lex("()[]{}");
        let kinds: Vec<_> = tokens.iter().map(|t| t.kind).collect();
        assert_eq!(
            kinds,
            vec![
                Kind::LParen,
                Kind::RParen,
                Kind::LBracket,
                Kind::RBracket,
                Kind::LBrace,
                Kind::RBrace,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_lexer_keywords() {
        let tokens = lex("theory instance Sort Prop forall exists");
        let kinds: Vec<_> = tokens.iter().map(|t| t.kind).collect();
        assert_eq!(
            kinds,
            vec![
                Kind::KwTheory,
                Kind::KwInstance,
                Kind::KwSort,
                Kind::KwProp,
                Kind::KwForall,
                Kind::KwExists,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_lexer_punctuation() {
        let tokens = lex(": ; , -> |-");
        let kinds: Vec<_> = tokens.iter().map(|t| t.kind).collect();
        assert_eq!(
            kinds,
            vec![
                Kind::Colon,
                Kind::Semicolon,
                Kind::Comma,
                Kind::Arrow,
                Kind::Turnstile,
                Kind::Eof
            ]
        );
    }

    #[test]
    fn test_lexer_identifiers() {
        let tokens = lex("foo Bar _baz");
        assert_eq!(tokens[0].kind, Kind::Ident);
        assert_eq!(tokens[1].kind, Kind::Ident);
        assert_eq!(tokens[2].kind, Kind::Ident);
    }

    #[test]
    fn test_lexer_qualified_name() {
        // In the new lexer, qualified names are parsed by the parser, not lexer
        // The lexer produces separate Ident, Slash, Ident tokens
        let tokens = lex("ax/sym");
        // Should be: Ident, Slash, Ident, Eof
        assert_eq!(tokens[0].kind, Kind::Ident);
        assert_eq!(tokens[1].kind, Kind::Slash);
        assert_eq!(tokens[2].kind, Kind::Ident);
    }

    #[test]
    fn test_lexer_connectives() {
        let tokens = lex("/\\ \\/ =");
        let kinds: Vec<_> = tokens.iter().map(|t| t.kind).collect();
        assert_eq!(kinds, vec![Kind::And, Kind::Or, Kind::Eq, Kind::Eof]);
    }

    #[test]
    fn test_lexer_comments() {
        let tokens = lex("foo // this is a comment\nbar");
        let kinds: Vec<_> = tokens.iter().map(|t| t.kind).collect();
        // Comments and newlines are skipped in the new lexer
        assert_eq!(kinds, vec![Kind::Ident, Kind::Ident, Kind::Eof]);
    }

    // Parser tests for new syntax
    #[test]
    fn test_parse_empty_theory() {
        let result = parse("theory Empty {}");
        assert!(result.is_ok());
        let file = result.unwrap();
        assert_eq!(file.declarations.len(), 1);
        match &file.declarations[0].node {
            Declaration::Theory(t) => {
                assert_eq!(t.name, "Empty");
                assert!(t.body.is_empty());
            }
            _ => panic!("expected theory"),
        }
    }

    #[test]
    fn test_parse_theory_with_sort() {
        let result = parse("theory T { M : Sort; }");
        assert!(result.is_ok());
        let file = result.unwrap();
        match &file.declarations[0].node {
            Declaration::Theory(t) => {
                assert_eq!(t.body.len(), 1);
            }
            _ => panic!("expected theory"),
        }
    }

    #[test]
    fn test_parse_theory_with_function() {
        let result = parse("theory Monoid { M : Sort; mul : [x: M, y: M] -> M; }");
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_axiom() {
        let result = parse("theory T { M : Sort; ax/test : forall x : M. |- x = x; }");
        assert!(result.is_ok());
    }

    // Diagnostic tests
    #[test]
    fn test_diagnostic_format() {
        let file = File::new("test.geolog", "theory T {}");
        let diag = Diagnostic::error(Span { start: 0, end: 6 }, "test error");
        let formatted = diag.format(&file);
        assert!(formatted.contains("Error"));
        assert!(formatted.contains("test.geolog"));
    }
}
