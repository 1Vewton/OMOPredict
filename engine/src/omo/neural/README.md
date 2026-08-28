# omo.neural —— 神经网络代理模型（M2.5 已实现，v1）

## 职责

用 NN 逼近物理引擎的「结构参数 → 性能」映射，作为**仿真加速器与优化代理**：

- 正向代理：输入三层厚度 → 输出 T(λ) 光谱、Rs、SE(f) 曲线
- **物理引擎仍是唯一验证基准，NN 不替代物理引擎**（AGENTS.md §3.6）

## 已实现模块

| 模块 | 职责 |
|---|---|
| `data.py` | 引擎生成数据：`generate_dataset` / `SurrogateConfig` / `SurrogateDataset`（固定种子、20% 边界样本、管线版本化） |
| `model.py` | `SurrogateModel`：MLP（3 → 隐藏 → 82 输出）、z-score 归一化、早停、`train/predict/save/load` |
| `validate.py` | `validate`：独立测试集（不同种子）与引擎对比 → `SurrogateValidationReport`（T/Rs/SE 的 MAE/RMSE + 训练域边界） |

## 如何调用

```python
from omo.neural import SurrogateConfig, SurrogateDataset, SurrogateModel, generate_dataset, validate
from omo.neural.data import PIPELINE_VERSION

# 1. 引擎生成数据（20k 样本默认；训练/测试用不同种子防泄漏）
train = generate_dataset(SurrogateConfig(n_samples=20_000, seed=42))
test = generate_dataset(SurrogateConfig(n_samples=2_000, seed=7))

# 2. 训练（固定种子，可复现）
model = SurrogateModel(train.config)
model.train(train)                    # -> {"val_loss_best": ..., "epochs_run": ...}

# 3. 预测（反归一化到物理单位）
pred = model.predict([[40.0, 10.0, 40.0]])   # ITO(40)/Ag(10)/ITO(40)
pred.transmittance      # (1, 63) 波长 380–1000 nm
pred.sheet_resistance   # (1,) Ω/sq
pred.se_db              # (1, 18) 频率 1–18 GHz

# 4. 验证（引擎为基准）+ 外推风险
report = validate(model, test)
report.save_json("surrogate_report.json")

# 5. 持久化（交付含配置/管线版本，非黑盒）
model.save("surrogate.pt")
loaded = SurrogateModel.load("surrogate.pt")
```

## 数据守则（AGENTS.md §6.9）

- 训练数据一律由物理引擎生成并版本化（`PIPELINE_VERSION` + 固定种子）；文献实测仅用于事后校准
- 采样覆盖参数空间边界（20% 边界样本含角点）；训练/测试不同种子
- Rs 取 log₁₀ 训练；光谱/SE 用固定网格向量回归
- 预测超出训练域（oxide 20–80 nm、metal 5–20 nm）属于**外推**，精度不保证（报告含训练域）

## 实测结果（20k 训练 / 3k 独立测试，引擎为基准）

| 指标 | 值 |
|---|---|
| T(λ) MAE / RMSE | 0.0009 / 0.0011 |
| Rs 相对误差 | 0.2%（log₁₀ MAE 0.0009） |
| SE MAE / RMSE | 0.02 / 0.02 dB |

复现：`cd engine && uv run python scripts/train_surrogate.py`
（产物：`artifacts/surrogate_ito_ag_ito.pt`、`docs/benchmarks/surrogate_report.json`，均已 gitignore）。

## v1 范围与扩展

- v1：ITO/Ag/ITO 三层，输入三个厚度，材料固定（ITO n=1.8、Ag Drude、玻璃衬底）
- 扩展路线：材料参数（n/ρ/γ）入特征、更多体系、逆向设计（目标性能 → 厚度）
