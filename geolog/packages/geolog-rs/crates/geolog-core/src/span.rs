/// Byte position in source
pub type Pos = u32;

/// Span of bytes in source
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Span {
    pub start: Pos,
    pub end: Pos,
}
