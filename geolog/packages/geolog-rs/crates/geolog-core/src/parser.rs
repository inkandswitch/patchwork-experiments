//! Parser for Geolog
//!
//! Hand-written recursive descent parser for the geolog-zeta syntax.
//! Parses token streams into AST.

use crate::ast::*;
use crate::diagnostic::Diagnostic;
use crate::lexer::{lex, Kind, Token};
use crate::span::Span;

/// Parser state
pub struct Parser {
    tokens: Vec<Token>,
    pos: usize,
    diagnostics: Vec<Diagnostic>,
}

/// Parse result
pub type ParseResult<T> = Result<T, ParseError>;

#[derive(Clone, Debug)]
pub struct ParseError {
    pub message: String,
    pub span: Span,
}

impl ParseError {
    fn new(message: impl Into<String>, span: Span) -> Self {
        Self {
            message: message.into(),
            span,
        }
    }
}

impl Parser {
    pub fn new(tokens: Vec<Token>) -> Self {
        Self {
            tokens,
            pos: 0,
            diagnostics: Vec::new(),
        }
    }

    // ========================================================================
    // Token access
    // ========================================================================

    fn peek(&self) -> &Token {
        self.tokens
            .get(self.pos)
            .unwrap_or(&self.tokens[self.tokens.len() - 1])
    }

    fn peek_kind(&self) -> Kind {
        self.peek().kind
    }

    fn at(&self, kind: Kind) -> bool {
        self.peek_kind() == kind
    }

    fn at_any(&self, kinds: &[Kind]) -> bool {
        kinds.contains(&self.peek_kind())
    }

    fn advance(&mut self) -> Token {
        let tok = self.peek().clone();
        if self.pos < self.tokens.len() - 1 {
            self.pos += 1;
        }
        tok
    }

    fn expect(&mut self, kind: Kind) -> ParseResult<Token> {
        if self.at(kind) {
            Ok(self.advance())
        } else {
            Err(ParseError::new(
                format!("expected {}, found {}", kind, self.peek_kind()),
                self.peek().span,
            ))
        }
    }

    fn consume(&mut self, kind: Kind) -> bool {
        if self.at(kind) {
            self.advance();
            true
        } else {
            false
        }
    }

    fn span_from(&self, start: Span) -> Span {
        let end = if self.pos > 0 {
            self.tokens[self.pos - 1].span.end
        } else {
            start.end
        };
        Span {
            start: start.start,
            end,
        }
    }

    // ========================================================================
    // Path parsing
    // ========================================================================

    /// Parse a path: `foo` or `foo/bar/baz`
    fn parse_path(&mut self) -> ParseResult<Path> {
        let first = self.expect(Kind::Ident)?;
        let mut segments = vec![first.text];

        while self.consume(Kind::Slash) {
            let next = self.expect(Kind::Ident)?;
            segments.push(next.text);
        }

        Ok(Path::from_segments(segments))
    }

    /// Try to parse a path, return None if not at an identifier
    fn try_parse_path(&mut self) -> Option<Path> {
        if self.at(Kind::Ident) {
            self.parse_path().ok()
        } else {
            None
        }
    }

    // ========================================================================
    // Type expression parsing (concatenative style)
    // ========================================================================

    /// Parse a full type expression with arrows
    fn parse_type_expr(&mut self) -> ParseResult<TypeExpr> {
        self.parse_type_expr_with_arrow()
    }

    /// Parse type expression with arrows
    fn parse_type_expr_with_arrow(&mut self) -> ParseResult<TypeExpr> {
        // Parse chunks separated by ->
        let mut chunks = vec![self.parse_type_chunk()?];

        while self.consume(Kind::Arrow) {
            chunks.push(self.parse_type_chunk()?);
        }

        // Flatten chunks and add Arrow tokens at the end
        let num_arrows = chunks.len() - 1;
        let mut tokens: Vec<TypeToken> = chunks.into_iter().flat_map(|c| c.tokens).collect();

        for _ in 0..num_arrows {
            tokens.push(TypeToken::Arrow);
        }

        Ok(TypeExpr { tokens })
    }

    /// Parse a type chunk (tokens before an arrow)
    fn parse_type_chunk(&mut self) -> ParseResult<TypeExpr> {
        let mut tokens = Vec::new();

        loop {
            match self.peek_kind() {
                Kind::KwSort => {
                    self.advance();
                    tokens.push(TypeToken::Sort);
                }
                Kind::KwProp => {
                    self.advance();
                    tokens.push(TypeToken::Prop);
                }
                Kind::KwInt => {
                    self.advance();
                    tokens.push(TypeToken::Int);
                }
                Kind::KwStr => {
                    self.advance();
                    tokens.push(TypeToken::Str);
                }
                Kind::KwInstance => {
                    self.advance();
                    tokens.push(TypeToken::Instance);
                }
                Kind::Ident => {
                    let path = self.parse_path()?;
                    tokens.push(TypeToken::Path(path));
                }
                Kind::LParen => {
                    // Parenthesized type expression
                    self.advance();
                    let inner = self.parse_type_expr()?;
                    self.expect(Kind::RParen)?;
                    tokens.extend(inner.tokens);
                }
                Kind::LBracket => {
                    // Record type: [field: Type, ...]
                    let record = self.parse_record_type()?;
                    tokens.push(TypeToken::Record(record));
                }
                _ => break,
            }
        }

        if tokens.is_empty() {
            return Err(ParseError::new(
                "expected type expression",
                self.peek().span,
            ));
        }

        Ok(TypeExpr { tokens })
    }

    /// Parse a type expression without top-level arrows (for function domain)
    fn parse_type_expr_no_arrow(&mut self) -> ParseResult<TypeExpr> {
        self.parse_type_chunk()
    }

    /// Parse record type fields: [field: Type, ...]
    fn parse_record_type(&mut self) -> ParseResult<Vec<(String, TypeExpr)>> {
        self.expect(Kind::LBracket)?;
        let mut fields = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut positional_idx = 0usize;

        if !self.at(Kind::RBracket) {
            loop {
                let field_start = self.peek().span;

                // Check if this is a named field (ident followed by colon)
                let (name, ty) = if self.at(Kind::Ident)
                    && self.peek_at_offset(1).map(|t| t.kind) == Some(Kind::Colon)
                {
                    let name = self.advance().text;
                    self.advance(); // :
                    let ty = self.parse_type_expr()?;
                    (name, ty)
                } else {
                    // Positional field
                    let ty = self.parse_type_expr()?;
                    let name = positional_idx.to_string();
                    positional_idx += 1;
                    (name, ty)
                };

                if !seen.insert(name.clone()) {
                    return Err(ParseError::new(
                        format!("duplicate field name: {}", name),
                        field_start,
                    ));
                }

                fields.push((name, ty));

                if !self.consume(Kind::Comma) {
                    break;
                }
            }
        }

        self.expect(Kind::RBracket)?;
        Ok(fields)
    }

    fn peek_at_offset(&self, offset: usize) -> Option<&Token> {
        self.tokens.get(self.pos + offset)
    }

    // ========================================================================
    // Term parsing
    // ========================================================================

    /// Parse a term
    fn parse_term(&mut self) -> ParseResult<Term> {
        let mut term = self.parse_term_atom()?;

        // Postfix operations: application and projection
        loop {
            if self.consume(Kind::Dot) {
                // Field projection: .field
                let field = self.expect(Kind::Ident)?;
                term = Term::Project(Box::new(term), field.text);
            } else if self.at_term_start() {
                // Application: term term
                let arg = self.parse_term_atom()?;
                term = Term::App(Box::new(term), Box::new(arg));
            } else {
                break;
            }
        }

        Ok(term)
    }

    fn at_term_start(&self) -> bool {
        matches!(
            self.peek_kind(),
            Kind::Ident | Kind::LBracket | Kind::LParen
        )
    }

    /// Check if the current token indicates the end of a formula context.
    /// Used to detect empty bodies in existential formulas (e.g. `exists x : X.`).
    fn at_formula_end(&self) -> bool {
        matches!(
            self.peek_kind(),
            Kind::Semicolon
                | Kind::Turnstile
                | Kind::RParen
                | Kind::Or
                | Kind::And
                | Kind::Comma
                | Kind::Eof
        )
    }

    /// Parse a term atom (no postfix operations)
    fn parse_term_atom(&mut self) -> ParseResult<Term> {
        match self.peek_kind() {
            Kind::Ident => {
                let path = self.parse_path()?;
                Ok(Term::Path(path))
            }
            Kind::LBracket => {
                let fields = self.parse_record_term()?;
                Ok(Term::Record(fields))
            }
            Kind::LParen => {
                self.advance();
                let term = self.parse_term()?;
                self.expect(Kind::RParen)?;
                Ok(term)
            }
            _ => Err(ParseError::new(
                format!("expected term, found {}", self.peek_kind()),
                self.peek().span,
            )),
        }
    }

    /// Parse record term: [field: term, ...]
    fn parse_record_term(&mut self) -> ParseResult<Vec<(String, Term)>> {
        self.expect(Kind::LBracket)?;
        let mut fields = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut positional_idx = 0usize;

        if !self.at(Kind::RBracket) {
            loop {
                let field_start = self.peek().span;

                // Check if this is a named field
                let (name, term) = if self.at(Kind::Ident)
                    && self.peek_at_offset(1).map(|t| t.kind) == Some(Kind::Colon)
                {
                    let name = self.advance().text;
                    self.advance(); // :
                    let term = self.parse_term()?;
                    (name, term)
                } else {
                    // Positional field
                    let term = self.parse_term()?;
                    let name = positional_idx.to_string();
                    positional_idx += 1;
                    (name, term)
                };

                if !seen.insert(name.clone()) {
                    return Err(ParseError::new(
                        format!("duplicate field name: {}", name),
                        field_start,
                    ));
                }

                fields.push((name, term));

                if !self.consume(Kind::Comma) {
                    break;
                }
            }
        }

        self.expect(Kind::RBracket)?;
        Ok(fields)
    }

    // ========================================================================
    // Formula parsing
    // ========================================================================

    /// Parse a formula
    fn parse_formula(&mut self) -> ParseResult<Formula> {
        self.parse_formula_or()
    }

    /// Parse disjunction: phi \/ psi
    fn parse_formula_or(&mut self) -> ParseResult<Formula> {
        let mut left = self.parse_formula_and()?;

        while self.consume(Kind::Or) {
            let right = self.parse_formula_and()?;
            left = match left {
                Formula::Or(mut disjuncts) => {
                    disjuncts.push(right);
                    Formula::Or(disjuncts)
                }
                _ => Formula::Or(vec![left, right]),
            };
        }

        Ok(left)
    }

    /// Parse conjunction: phi /\ psi
    fn parse_formula_and(&mut self) -> ParseResult<Formula> {
        let mut left = self.parse_formula_atom()?;

        while self.consume(Kind::And) {
            let right = self.parse_formula_atom()?;
            left = match left {
                Formula::And(mut conjuncts) => {
                    conjuncts.push(right);
                    Formula::And(conjuncts)
                }
                _ => Formula::And(vec![left, right]),
            };
        }

        Ok(left)
    }

    /// Parse a formula atom
    fn parse_formula_atom(&mut self) -> ParseResult<Formula> {
        match self.peek_kind() {
            Kind::KwTrue => {
                self.advance();
                Ok(Formula::True)
            }
            Kind::KwFalse => {
                self.advance();
                Ok(Formula::False)
            }
            Kind::KwExists => {
                self.advance();
                let vars = self.parse_quantified_vars()?;
                self.expect(Kind::Dot)?;
                // Body can be comma-separated conjunction.
                // An empty body (exists x : X.) is interpreted as True.
                let body = if self.at_formula_end() {
                    Formula::True
                } else {
                    self.parse_formula_conjunction_list()?
                };
                Ok(Formula::Exists(vars, Box::new(body)))
            }
            Kind::LParen => {
                self.advance();
                let formula = self.parse_formula()?;
                self.expect(Kind::RParen)?;
                Ok(formula)
            }
            _ => {
                // Term-based formula: equality, comparison, or relation application
                let term = self.parse_term()?;

                if self.consume(Kind::Eq) {
                    // Equality: term = term
                    let rhs = self.parse_term()?;
                    Ok(Formula::Eq(term, rhs))
                } else if self.consume(Kind::Lt) {
                    // Less than: term < term
                    let rhs = self.parse_term()?;
                    Ok(Formula::Lt(term, rhs))
                } else if self.consume(Kind::Le) {
                    // Less than or equal: term <= term
                    let rhs = self.parse_term()?;
                    Ok(Formula::Le(term, rhs))
                } else if self.consume(Kind::Gt) {
                    // Greater than: term > term
                    let rhs = self.parse_term()?;
                    Ok(Formula::Gt(term, rhs))
                } else if self.consume(Kind::Ge) {
                    // Greater than or equal: term >= term
                    let rhs = self.parse_term()?;
                    Ok(Formula::Ge(term, rhs))
                } else {
                    // Relation application: term rel (postfix)
                    // The term should be App(base, Path(rel))
                    match term {
                        Term::App(base, rel_term) => {
                            if let Term::Path(path) = *rel_term {
                                if let Some(rel_name) = path.as_single() {
                                    Ok(Formula::RelApp(rel_name.to_string(), *base))
                                } else {
                                    Err(ParseError::new(
                                        "relation name must be a single identifier",
                                        self.peek().span,
                                    ))
                                }
                            } else {
                                Err(ParseError::new("expected relation name", self.peek().span))
                            }
                        }
                        _ => Err(ParseError::new(
                            "expected relation application (term rel) or equality (term = term)",
                            self.peek().span,
                        )),
                    }
                }
            }
        }
    }

    /// Parse comma-separated conjunction of formulas (for exists body)
    fn parse_formula_conjunction_list(&mut self) -> ParseResult<Formula> {
        let mut formulas = vec![self.parse_formula()?];

        while self.consume(Kind::Comma) {
            formulas.push(self.parse_formula()?);
        }

        Ok(Formula::and(formulas))
    }

    /// Parse quantified variables: x : T or x, y : T
    fn parse_quantified_vars(&mut self) -> ParseResult<Vec<QuantifiedVar>> {
        let mut vars = Vec::new();

        loop {
            let mut names = vec![self.expect(Kind::Ident)?.text];

            while self.consume(Kind::Comma) {
                // Could be another name or the start of a new variable group
                if self.at(Kind::Ident)
                    && self.peek_at_offset(1).map(|t| t.kind) != Some(Kind::Colon)
                {
                    names.push(self.expect(Kind::Ident)?.text);
                } else {
                    break;
                }
            }

            self.expect(Kind::Colon)?;
            let ty = self.parse_type_expr()?;
            vars.push(QuantifiedVar { names, ty });

            // Check if there are more variables (comma followed by ident : type pattern)
            if self.at(Kind::Comma) && self.peek_at_offset(1).map(|t| t.kind) == Some(Kind::Ident) {
                // Lookahead to see if this starts a new variable group
                // (ident colon pattern)
                let mut offset = 1;
                while self.peek_at_offset(offset).map(|t| t.kind) == Some(Kind::Ident) {
                    offset += 1;
                    if self.peek_at_offset(offset).map(|t| t.kind) == Some(Kind::Comma) {
                        offset += 1;
                    } else {
                        break;
                    }
                }
                if self.peek_at_offset(offset).map(|t| t.kind) == Some(Kind::Colon) {
                    self.advance(); // consume comma
                    continue;
                }
            }

            break;
        }

        Ok(vars)
    }

    // ========================================================================
    // Axiom parsing
    // ========================================================================

    /// Parse an axiom declaration
    fn parse_axiom_decl(&mut self, name: Path) -> ParseResult<AxiomDecl> {
        // name : forall vars. hypotheses |- conclusion
        self.expect(Kind::Colon)?;
        self.expect(Kind::KwForall)?;

        // Allow empty quantifier list: `forall .` means no universally quantified variables
        let quantified = if self.at(Kind::Dot) {
            Vec::new()
        } else {
            self.parse_quantified_vars()?
        };
        self.expect(Kind::Dot)?;

        // Hypotheses (comma separated) before |-
        let mut hypotheses = Vec::new();
        if !self.at(Kind::Turnstile) {
            loop {
                hypotheses.push(self.parse_formula()?);
                if !self.consume(Kind::Comma) {
                    break;
                }
                if self.at(Kind::Turnstile) {
                    break;
                }
            }
        }

        self.expect(Kind::Turnstile)?;
        let conclusion = self.parse_formula()?;

        Ok(AxiomDecl {
            name,
            quantified,
            hypotheses,
            conclusion,
        })
    }

    // ========================================================================
    // Theory parsing
    // ========================================================================

    /// Parse a theory item
    fn parse_theory_item(&mut self) -> ParseResult<TheoryItem> {
        let start = self.peek().span;

        // First token is always an identifier (or path for axioms/functions)
        let first_ident = self.expect(Kind::Ident)?;

        // Check what follows
        if self.at(Kind::Slash)
            || (self.at(Kind::Colon)
                && self.peek_at_offset(1).map(|t| t.kind) == Some(Kind::KwForall))
        {
            // Path followed by : forall -> axiom
            // OR name : forall -> axiom
            let mut segments = vec![first_ident.text];
            while self.consume(Kind::Slash) {
                segments.push(self.expect(Kind::Ident)?.text);
            }
            let name = Path::from_segments(segments);

            if self.at(Kind::Colon)
                && self.peek_at_offset(1).map(|t| t.kind) == Some(Kind::KwForall)
            {
                let axiom = self.parse_axiom_decl(name)?;
                self.expect(Kind::Semicolon)?;
                return Ok(TheoryItem::Axiom(axiom));
            }

            // Otherwise it's a function: path : domain -> codomain
            self.expect(Kind::Colon)?;
            let domain = self.parse_type_expr_no_arrow()?;
            self.expect(Kind::Arrow)?;
            let codomain = self.parse_type_expr()?;
            self.expect(Kind::Semicolon)?;
            return Ok(TheoryItem::Function(FunctionDecl {
                name,
                domain,
                codomain,
            }));
        }

        // name : ...
        self.expect(Kind::Colon)?;

        // Check what follows the colon
        if self.at(Kind::KwSort) {
            // Sort declaration: name : Sort;
            self.advance();
            self.expect(Kind::Semicolon)?;
            return Ok(TheoryItem::Sort(first_ident.text));
        }

        if self.at(Kind::KwForall) {
            // Axiom: name : forall ...
            let name = Path::single(first_ident.text);
            let axiom = self.parse_axiom_decl_after_colon(name)?;
            self.expect(Kind::Semicolon)?;
            return Ok(TheoryItem::Axiom(axiom));
        }

        // Could be function or field
        // Parse the domain type (without consuming arrow, so we can detect function vs field)
        let domain = self.parse_type_expr_no_arrow()?;

        if self.consume(Kind::Arrow) {
            // Function declaration: name : domain -> codomain
            let codomain = self.parse_type_expr()?;
            self.expect(Kind::Semicolon)?;
            return Ok(TheoryItem::Function(FunctionDecl {
                name: Path::single(first_ident.text),
                domain,
                codomain,
            }));
        }

        // Field declaration: name : type;
        self.expect(Kind::Semicolon)?;
        Ok(TheoryItem::Field(first_ident.text, domain))
    }

    fn parse_axiom_decl_after_colon(&mut self, name: Path) -> ParseResult<AxiomDecl> {
        // forall vars. hypotheses |- conclusion
        self.expect(Kind::KwForall)?;

        // Allow empty quantifier list: `forall .` means no universally quantified variables
        let quantified = if self.at(Kind::Dot) {
            Vec::new()
        } else {
            self.parse_quantified_vars()?
        };
        self.expect(Kind::Dot)?;

        // Hypotheses before |-
        let mut hypotheses = Vec::new();
        if !self.at(Kind::Turnstile) {
            loop {
                hypotheses.push(self.parse_formula()?);
                if !self.consume(Kind::Comma) {
                    break;
                }
                if self.at(Kind::Turnstile) {
                    break;
                }
            }
        }

        self.expect(Kind::Turnstile)?;
        let conclusion = self.parse_formula()?;

        Ok(AxiomDecl {
            name,
            quantified,
            hypotheses,
            conclusion,
        })
    }

    /// Parse a theory declaration
    fn parse_theory_decl(&mut self) -> ParseResult<TheoryDecl> {
        self.expect(Kind::KwTheory)?;

        // Parse optional parameters: (name : Type)
        let mut params = Vec::new();
        while self.consume(Kind::LParen) {
            loop {
                let name = self.expect(Kind::Ident)?.text;
                self.expect(Kind::Colon)?;
                let ty = self.parse_type_expr()?;
                params.push(Param { name, ty });

                if !self.consume(Kind::Comma) {
                    break;
                }
            }
            self.expect(Kind::RParen)?;
        }

        // Theory name
        let name = self.expect(Kind::Ident)?.text;

        // Optional extends clause
        let extends = if self.at(Kind::KwExtends) {
            self.advance();
            Some(self.parse_path()?)
        } else if self.at(Kind::Ident) && self.peek().text == "extends" {
            self.advance();
            Some(self.parse_path()?)
        } else {
            None
        };

        // Body
        self.expect(Kind::LBrace)?;
        let mut body = Vec::new();

        while !self.at(Kind::RBrace) && !self.at(Kind::Eof) {
            let start = self.peek().span;
            let item = self.parse_theory_item()?;
            let span = self.span_from(start);
            body.push(Spanned::new(item, span));
        }

        self.expect(Kind::RBrace)?;

        Ok(TheoryDecl {
            params,
            name,
            extends,
            body,
        })
    }

    // ========================================================================
    // Instance parsing
    // ========================================================================

    /// Parse an instance item
    fn parse_instance_item(&mut self) -> ParseResult<InstanceItem> {
        // Check for nested instance: name = { ... }
        if self.at(Kind::Ident)
            && self.peek_at_offset(1).map(|t| t.kind) == Some(Kind::Eq)
            && self.peek_at_offset(2).map(|t| t.kind) == Some(Kind::LBrace)
        {
            let name = self.advance().text;
            self.advance(); // =
            let nested = self.parse_nested_instance()?;
            self.expect(Kind::Semicolon)?;
            return Ok(InstanceItem::NestedInstance(name, nested));
        }

        // Check for element declaration: name : Type; or name, name : Type;
        if self.at(Kind::Ident) {
            // Lookahead to check for element declaration pattern
            let mut offset = 0;
            let mut names_count = 1;
            loop {
                offset += 1; // skip ident
                if self.peek_at_offset(offset).map(|t| t.kind) == Some(Kind::Comma) {
                    offset += 1;
                    if self.peek_at_offset(offset).map(|t| t.kind) == Some(Kind::Ident) {
                        names_count += 1;
                        continue;
                    }
                }
                break;
            }

            if self.peek_at_offset(offset).map(|t| t.kind) == Some(Kind::Colon) {
                // Element declaration
                let mut names = vec![self.advance().text];
                while self.consume(Kind::Comma) {
                    names.push(self.expect(Kind::Ident)?.text);
                }
                self.expect(Kind::Colon)?;
                let ty = self.parse_type_expr()?;
                self.expect(Kind::Semicolon)?;
                return Ok(InstanceItem::Element(names, ty));
            }
        }

        // Check for relation assertion: [fields] rel; or term rel;
        if self.at(Kind::LBracket) {
            let term = self.parse_term()?;
            let rel = self.expect(Kind::Ident)?.text;
            self.expect(Kind::Semicolon)?;
            return Ok(InstanceItem::RelationAssertion(term, rel));
        }

        // Must be an equation: term = term;
        let lhs = self.parse_term()?;
        self.expect(Kind::Eq)?;
        let rhs = self.parse_term()?;
        self.expect(Kind::Semicolon)?;
        Ok(InstanceItem::Equation(lhs, rhs))
    }

    fn parse_nested_instance(&mut self) -> ParseResult<InstanceDecl> {
        self.expect(Kind::LBrace)?;
        let mut body = Vec::new();

        while !self.at(Kind::RBrace) && !self.at(Kind::Eof) {
            let start = self.peek().span;
            let item = self.parse_instance_item()?;
            let span = self.span_from(start);
            body.push(Spanned::new(item, span));
        }

        self.expect(Kind::RBrace)?;

        Ok(InstanceDecl {
            theory: TypeExpr::single_path(Path::single("_inferred")),
            name: String::new(),
            body,
            needs_chase: false,
        })
    }

    /// Parse an instance declaration
    fn parse_instance_decl(&mut self) -> ParseResult<InstanceDecl> {
        self.expect(Kind::KwInstance)?;
        let name = self.expect(Kind::Ident)?.text;
        self.expect(Kind::Colon)?;

        // Parse theory type (without trailing 'instance' keyword)
        let theory = self.parse_type_expr_no_instance()?;

        self.expect(Kind::Eq)?;

        // Check for chase keyword
        let needs_chase = self.consume(Kind::KwChase);

        // Body
        self.expect(Kind::LBrace)?;
        let mut body = Vec::new();

        while !self.at(Kind::RBrace) && !self.at(Kind::Eof) {
            let start = self.peek().span;
            let item = self.parse_instance_item()?;
            let span = self.span_from(start);
            body.push(Spanned::new(item, span));
        }

        self.expect(Kind::RBrace)?;

        Ok(InstanceDecl {
            theory,
            name,
            body,
            needs_chase,
        })
    }

    /// Parse type expression without instance suffix (for instance headers)
    fn parse_type_expr_no_instance(&mut self) -> ParseResult<TypeExpr> {
        let mut tokens = Vec::new();

        loop {
            match self.peek_kind() {
                Kind::KwSort => {
                    self.advance();
                    tokens.push(TypeToken::Sort);
                }
                Kind::KwProp => {
                    self.advance();
                    tokens.push(TypeToken::Prop);
                }
                Kind::KwInstance => {
                    // Stop - don't consume instance keyword
                    break;
                }
                Kind::Ident => {
                    let path = self.parse_path()?;
                    tokens.push(TypeToken::Path(path));
                }
                Kind::LParen => {
                    self.advance();
                    let inner = self.parse_type_expr()?;
                    self.expect(Kind::RParen)?;
                    tokens.extend(inner.tokens);
                }
                Kind::LBracket => {
                    let record = self.parse_record_type()?;
                    tokens.push(TypeToken::Record(record));
                }
                _ => break,
            }
        }

        if tokens.is_empty() {
            return Err(ParseError::new(
                "expected type expression",
                self.peek().span,
            ));
        }

        Ok(TypeExpr { tokens })
    }

    // ========================================================================
    // Query parsing
    // ========================================================================

    fn parse_query_decl(&mut self) -> ParseResult<QueryDecl> {
        self.expect(Kind::KwQuery)?;
        let name = self.expect(Kind::Ident)?.text;
        self.expect(Kind::LBrace)?;
        self.expect(Kind::Question)?;
        self.expect(Kind::Colon)?;
        let goal = self.parse_type_expr()?;
        self.expect(Kind::Semicolon)?;
        self.expect(Kind::RBrace)?;

        Ok(QueryDecl { name, goal })
    }

    // ========================================================================
    // Top-level parsing
    // ========================================================================

    fn parse_declaration(&mut self) -> ParseResult<Declaration> {
        match self.peek_kind() {
            Kind::KwNamespace => {
                self.advance();
                let name = self.expect(Kind::Ident)?.text;
                self.expect(Kind::Semicolon)?;
                Ok(Declaration::Namespace(name))
            }
            Kind::KwTheory => Ok(Declaration::Theory(self.parse_theory_decl()?)),
            Kind::KwInstance => Ok(Declaration::Instance(self.parse_instance_decl()?)),
            Kind::KwQuery => Ok(Declaration::Query(self.parse_query_decl()?)),
            _ => Err(ParseError::new(
                format!("expected declaration, found {}", self.peek_kind()),
                self.peek().span,
            )),
        }
    }

    /// Parse a complete file
    pub fn parse_file(&mut self) -> ParseResult<File> {
        let mut declarations = Vec::new();

        while !self.at(Kind::Eof) {
            let start = self.peek().span;
            let decl = self.parse_declaration()?;
            let span = self.span_from(start);
            declarations.push(Spanned::new(decl, span));
        }

        Ok(File { declarations })
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Parse a source string into a File AST
pub fn parse(source: &str) -> ParseResult<File> {
    let tokens = lex(source);
    let mut parser = Parser::new(tokens);
    parser.parse_file()
}

/// Parse a source string into a File AST, returning diagnostics
pub fn parse_with_diagnostics(source: &str) -> (Option<File>, Vec<Diagnostic>) {
    let tokens = lex(source);
    let mut parser = Parser::new(tokens);
    match parser.parse_file() {
        Ok(file) => (Some(file), parser.diagnostics),
        Err(e) => {
            let mut diagnostics = parser.diagnostics;
            diagnostics.push(Diagnostic::error(e.span, e.message));
            (None, diagnostics)
        }
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_theory() {
        let source = r#"
            theory Graph {
                V : Sort;
                E : Sort;
                src : E -> V;
                tgt : E -> V;
            }
        "#;

        let file = parse(source).expect("parse failed");
        assert_eq!(file.declarations.len(), 1);

        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };
        assert_eq!(theory.name, "Graph");
        assert_eq!(theory.body.len(), 4);
    }

    #[test]
    fn test_parse_record_domain() {
        let source = r#"
            theory Monoid {
                M : Sort;
                mul : [x: M, y: M] -> M;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };

        // Check the mul function
        let TheoryItem::Function(mul) = &theory.body[1].node else {
            panic!("expected function");
        };
        assert_eq!(mul.name.to_string(), "mul");
        assert!(mul.domain.as_record().is_some());
    }

    #[test]
    fn test_parse_axiom() {
        let source = r#"
            theory Sym {
                V : Sort;
                E : [src: V, tgt: V] -> Prop;
                ax/sym : forall x : V, y : V. [src: x, tgt: y] E |- [src: y, tgt: x] E;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };

        let TheoryItem::Axiom(axiom) = &theory.body[2].node else {
            panic!("expected axiom");
        };
        assert_eq!(axiom.name.to_string(), "ax/sym");
        assert_eq!(axiom.quantified.len(), 2);
    }

    #[test]
    fn test_parse_instance() {
        let source = r#"
            theory Graph {
                V : Sort;
                E : Sort;
                src : E -> V;
            }

            instance Triangle : Graph = {
                A, B, C : V;
                ab : E;
                ab src = A;
            }
        "#;

        let file = parse(source).expect("parse failed");
        assert_eq!(file.declarations.len(), 2);

        let Declaration::Instance(inst) = &file.declarations[1].node else {
            panic!("expected instance");
        };
        assert_eq!(inst.name, "Triangle");
        assert_eq!(inst.body.len(), 3);
    }

    #[test]
    fn test_parse_parameterized_theory() {
        let source = r#"
            theory (N : PetriNet instance) Marking {
                Token : Sort;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };
        assert_eq!(theory.name, "Marking");
        assert_eq!(theory.params.len(), 1);
        assert_eq!(theory.params[0].name, "N");
    }

    #[test]
    fn test_parse_path() {
        let source = r#"
            theory T {
                in/src : In -> P;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };

        let TheoryItem::Function(func) = &theory.body[0].node else {
            panic!("expected function");
        };
        assert_eq!(func.name.to_string(), "in/src");
    }

    #[test]
    fn test_parse_comments() {
        let source = r#"
            // This is a comment
            theory Graph {
                V : Sort; // inline comment
                // another comment
                E : Sort;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };
        assert_eq!(theory.body.len(), 2);
    }

    #[test]
    fn test_parse_empty_quantifier() {
        let source = r#"
            theory T {
                X : Sort;
                ax/nonempty : forall . |- exists x : X.;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };

        let TheoryItem::Axiom(axiom) = &theory.body[1].node else {
            panic!("expected axiom");
        };
        assert_eq!(axiom.name.to_string(), "ax/nonempty");
        assert!(axiom.quantified.is_empty());
        assert!(axiom.hypotheses.is_empty());
    }

    #[test]
    fn test_parse_empty_existential_body() {
        let source = r#"
            theory T {
                X : Sort;
                ax/nonempty : forall . |- exists x : X.;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };

        let TheoryItem::Axiom(axiom) = &theory.body[1].node else {
            panic!("expected axiom");
        };
        // The conclusion should be an existential with True body
        match &axiom.conclusion {
            Formula::Exists(vars, body) => {
                assert_eq!(vars.len(), 1);
                assert_eq!(vars[0].names, vec!["x"]);
                assert!(matches!(**body, Formula::True));
            }
            other => panic!("expected Exists, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_existential_with_body_still_works() {
        let source = r#"
            theory T {
                V : Sort;
                E : [src: V, tgt: V] -> Prop;
                ax/connected : forall x : V, y : V. |- exists z : V. [src: x, tgt: z] E;
            }
        "#;

        let file = parse(source).expect("parse failed");
        let Declaration::Theory(theory) = &file.declarations[0].node else {
            panic!("expected theory");
        };

        let TheoryItem::Axiom(axiom) = &theory.body[2].node else {
            panic!("expected axiom");
        };
        match &axiom.conclusion {
            Formula::Exists(vars, body) => {
                assert_eq!(vars.len(), 1);
                // Body should not be True - it should be a relation application
                assert!(!matches!(**body, Formula::True));
            }
            other => panic!("expected Exists, got {:?}", other),
        }
    }

    #[test]
    fn test_reject_duplicate_field_names_in_record_type() {
        let source = r#"
            theory T {
                V : Sort;
                E : [src: V, src: V] -> Prop;
            }
        "#;

        let result = parse(source);
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("duplicate field name"));
    }

    #[test]
    fn test_reject_duplicate_field_names_in_record_term() {
        let source = r#"
            theory T {
                V : Sort;
                E : [src: V, tgt: V] -> Prop;
                ax/bad : forall x : V. |- [src: x, src: x] E;
            }
        "#;

        let result = parse(source);
        assert!(result.is_err());
        assert!(result.unwrap_err().message.contains("duplicate field name"));
    }
}
