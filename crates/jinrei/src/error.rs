use senkei_model::{ApiError, ApiErrorCode};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompileError {
    pub code: ApiErrorCode,
    pub message: String,
    pub path: Option<String>,
}

impl CompileError {
    pub(crate) fn new(code: ApiErrorCode, message: impl Into<String>) -> Self {
        Self { code, message: message.into(), path: None }
    }

    pub(crate) fn at(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    pub(crate) fn into_api(self) -> ApiError {
        let mut error = ApiError::new(self.code, self.message);
        error.path = self.path;
        error
    }
}

impl From<CompileError> for ApiError {
    fn from(value: CompileError) -> Self { value.into_api() }
}

pub fn compile_error(error: CompileError) -> ApiError { error.into_api() }
