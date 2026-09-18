// src-tauri/src/solver/models.rs
//
//! 模型参数规范
//!
//! 每个模型（func）在这里声明：
//!   - 参数名（与 meta.json 的 paramMap 对应）
//!   - 默认值（params 未提供时兜底）
//!   - 读取辅助函数
//!
//! 注意：这里只做"参数规范"，具体电气行为在 matrix_builder / result_extractor 中。

use super::input::SolverComponent;
use super::output::SolverError;

// ============================================================
// ohm
// ============================================================

pub const OHM_DEFAULT_R: f64 = 1000.0;

pub fn read_ohm_r(comp: &SolverComponent) -> f64 {
    read_param_f64(comp, "R").unwrap_or(OHM_DEFAULT_R)
}

// ============================================================
// diode（分段线性模型）
// ============================================================

/// 默认正向压降（硅二极管）
pub const DIODE_DEFAULT_VF: f64 = 0.7;
/// 默认导通电阻
pub const DIODE_DEFAULT_RON: f64 = 10.0;
/// 关断时的极小电导（避免矩阵奇异）
pub const DIODE_GMIN: f64 = 1e-9;

pub struct DiodeParams {
    pub vf: f64,
    pub ron: f64,
}

pub fn read_diode_params(comp: &SolverComponent) -> DiodeParams {
    DiodeParams {
        vf: read_param_f64(comp, "Vf").unwrap_or(DIODE_DEFAULT_VF),
        ron: read_param_f64(comp, "Ron").unwrap_or(DIODE_DEFAULT_RON),
    }
}

// ============================================================
// switch
// ============================================================

/// 闭合时的导通电阻
pub const SWITCH_DEFAULT_RON: f64 = 0.01;
/// 断开时的漏电阻
pub const SWITCH_DEFAULT_ROFF: f64 = 1e9;

pub struct SwitchParams {
    pub ron: f64,
    pub roff: f64,
    pub closed: bool,
}

pub fn read_switch_params(comp: &SolverComponent) -> SwitchParams {
    SwitchParams {
        ron: read_param_f64(comp, "Ron").unwrap_or(SWITCH_DEFAULT_RON),
        roff: read_param_f64(comp, "Roff").unwrap_or(SWITCH_DEFAULT_ROFF),
        closed: read_param_bool(comp, "closed").unwrap_or(false),
    }
}

// ============================================================
// voltage_source
// ============================================================

/// 电压源必须显式提供 V，无默认值
pub fn read_vsource_v(comp: &SolverComponent) -> Result<f64, SolverError> {
    read_param_f64(comp, "V").ok_or_else(|| SolverError::MissingParam {
        component_id: comp.id,
        param: "V".to_string(),
    })
}

// ============================================================
// current_source
// ============================================================

/// 电流源必须显式提供 I，无默认值
pub fn read_isource_i(comp: &SolverComponent) -> Result<f64, SolverError> {
    read_param_f64(comp, "I").ok_or_else(|| SolverError::MissingParam {
        component_id: comp.id,
        param: "I".to_string(),
    })
}

// ============================================================
// 参数读取辅助
// ============================================================

fn read_param_f64(comp: &SolverComponent, key: &str) -> Option<f64> {
    comp.params.get(key).and_then(|v| v.as_f64())
}

fn read_param_bool(comp: &SolverComponent, key: &str) -> Option<bool> {
    comp.params.get(key).and_then(|v| v.as_bool())
}
