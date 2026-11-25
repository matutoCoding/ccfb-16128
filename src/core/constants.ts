/**
 * 全局物理常量与网格定义。
 * CPU 公式模块与 GPU 着色器必须共用同一套数值，保证两端推演一致。
 * 单位约定：长度 英寸/英尺，油量 微升(uL)，角度 度。
 */

/** 球道板数（39 块板） */
export const BOARDS = 39;
/** 单板宽度（英寸），39 板 ≈ 41.5 in 标准球道宽度 */
export const BOARD_WIDTH_IN = 1.064;
/** 球道总宽（英寸） */
export const LANE_WIDTH_IN = BOARDS * BOARD_WIDTH_IN;
/** 犯规线到 1 号瓶中心的长度（英尺） */
export const FOUL_TO_PIN_FT = 60;
/** 瓶台延伸长度（英尺，渲染用） */
export const PIN_DECK_FT = 2.86;

/** 油纹理每英尺行数（沿球道方向离散精度） */
export const CELL_ROWS_PER_FT = 8;
/** 油纹理沿球道总行数（60ft × 8） */
export const CELL_ROWS = FOUL_TO_PIN_FT * CELL_ROWS_PER_FT; // 480
/** 油纹理横向列数（每块板一列） */
export const CELL_COLS = BOARDS; // 39
/** 单元格纵向尺寸（英寸） */
export const CELL_DEPTH_IN = 12 / CELL_ROWS_PER_FT; // 1.5 in

/** 打油机 1 个油量单位(load) ≈ 0.05 mL = 50 uL（Kegel 等机器通用标定） */
export const LOAD_UL = 50;

/** 保龄球直径（英寸，标准 8.5in） */
export const BALL_DIAMETER_IN = 8.5;
/** 保龄球半径（英寸） */
export const BALL_RADIUS_IN = BALL_DIAMETER_IN / 2;
/** 接触带半宽（英寸）：球与道面的油接触迹印宽度约 0.9~1.2in，半宽 ~0.5in */
export const CONTACT_HALF_WIDTH_IN = 0.52;
/** 接触带覆盖的板数（单侧），用于栅格化时的确定性枚举 */
export const CONTACT_HALF_BOARDS = Math.ceil(CONTACT_HALF_WIDTH_IN / BOARD_WIDTH_IN); // 1
/** 后段"吐油/带油"起始距离（英尺）：约 38ft 之后油被携带沉积 */
export const DEPOSIT_START_FT = 38;

/** 理想入袋位置（板号，1..39）。面向瓶区：右手 1-3 袋约 17.5 板，左手 1-2 袋约 21.5 板 */
export const POCKET_BOARD_R = 17.5;
export const POCKET_BOARD_L = 21.5;

/** 重力加速度（in/s²） */
export const GRAVITY_IN_S2 = 386.09;

/** 1 英里/小时 = 17.6 in/s */
export const MPH_TO_IN_S = 17.6;

/** 重新过油建议阈值：中段（20~40ft）平均剩余油比例低于该值即提示 */
export const REOIL_THRESHOLD = 0.35;

/** 推演最大局数 */
export const MAX_GAMES = 40;
/** 每局每道出手数（两人对打各 5 球左右，取典型联赛每道 8 球/局用于消耗建模） */
export const SHOTS_PER_GAME = 8;
