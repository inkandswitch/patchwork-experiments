use crate::span::{Pos, Span};

/// Source file with line break tracking
#[derive(Clone, Debug)]
pub struct File {
    pub name: String,
    pub contents: String,
    line_breaks: Vec<Pos>,
}

impl File {
    pub fn new(name: impl Into<String>, contents: impl Into<String>) -> Self {
        let contents = contents.into();
        let line_breaks = contents
            .bytes()
            .enumerate()
            .filter(|(_, b)| *b == b'\n')
            .map(|(i, _)| i as Pos)
            .collect();
        File {
            name: name.into(),
            contents,
            line_breaks,
        }
    }

    /// Convert byte offset to (line, column), both 1-indexed
    pub fn position(&self, offset: Pos) -> (usize, usize) {
        let line = self.line_breaks.partition_point(|&lb| lb < offset);
        let line_start = if line == 0 {
            0
        } else {
            self.line_breaks[line - 1] + 1
        };
        let col = offset - line_start;
        (line + 1, col as usize + 1)
    }
}

/// Diagnostic severity
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Warning,
    Error,
}

/// A diagnostic message
#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub severity: Severity,
    pub span: Span,
    pub message: String,
}

impl Diagnostic {
    pub fn error(span: Span, message: impl Into<String>) -> Self {
        Diagnostic {
            severity: Severity::Error,
            span,
            message: message.into(),
        }
    }

    pub fn warning(span: Span, message: impl Into<String>) -> Self {
        Diagnostic {
            severity: Severity::Warning,
            span,
            message: message.into(),
        }
    }

    pub fn format(&self, file: &File) -> String {
        let (line, col) = file.position(self.span.start);
        format!(
            "{:?} at {}:{}:{}: {}",
            self.severity, file.name, line, col, self.message
        )
    }
}
