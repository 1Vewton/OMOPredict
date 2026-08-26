# omo.neural —— 神经网络代理模型

## 职责

用 NN 逼近物理引擎的「结构参数 → 性能」映射，作为**仿真加速器与优化代理**：

- 正向代理：输入各层厚度 / 光学常数 / 电阻率 → 输出 T(λ)、Rs、SE(f)
- **物理引擎仍是唯一验证基准，NN 不替代物理引擎**（见 AGENTS.md §3.6）

## 核心模块（计划，M2.5 实现）

- `data/`：由物理引擎生成训练数据（版本化、固定随机种子）
- `train.py` / `inference.py`：代理模型训练与推理
- `validate.py`：与物理引擎的 MAE/RMSE 对比与外推风险报告

## 如何调用（计划接口，M2.5 落地后生效）

```python
from omo.neural import SurrogateModel
from omo.neural.data import generate_dataset

X, y = generate_dataset(n_samples=50_000, seed=42)
model = SurrogateModel()
model.train(X, y)
T_pred, Rs_pred, SE_pred = model.predict(stack=("ito", 40.0, "ag", 10.0, "ito", 40.0))
```

## 数据守则

- 训练数据一律由物理引擎生成并版本化；文献实测仅用于事后校准与验证
- Rs 等跨数量级目标取 log 训练；光谱输出用固定波长网格向量回归
- 交付必须含可复现脚本（数据生成种子、超参数、训练配置），不交付"黑盒权重"
