use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub error: String,
    pub code: String,
    pub trace_id: String,
}

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>, trace_id: impl Into<String>) -> Self {
        Self {
            error: message.into(),
            code: code.into(),
            trace_id: trace_id.into(),
        }
    }

    pub fn validation(message: impl Into<String>, trace_id: impl Into<String>) -> Self {
        Self::new("ERR_VALIDATION", message, trace_id)
    }

    pub fn dependency(message: impl Into<String>, trace_id: impl Into<String>) -> Self {
        Self::new("ERR_DEPENDENCY", message, trace_id)
    }

    pub fn system(message: impl Into<String>, trace_id: impl Into<String>) -> Self {
        Self::new("ERR_SYSTEM", message, trace_id)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.error, self.code)
    }
}

impl std::error::Error for AppError {}
