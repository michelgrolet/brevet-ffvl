# ML Frameworks — The Essentials

A quick-reference for **PyTorch**, **TensorFlow/Keras**, and **Scikit-Learn**.
Just what you need to sound (and be) competent.

---

## TL;DR — When to use what

| Framework | Use it for | Mental model |
|---|---|---|
| **Scikit-Learn** | Classical ML on tabular data (regression, trees, SVM, clustering), quick baselines, preprocessing | "fit / predict" on NumPy arrays |
| **PyTorch** | Deep learning, research, custom architectures, full control | Pythonic, dynamic graphs, you write the training loop |
| **TensorFlow/Keras** | Deep learning, production & deployment (mobile, web, serving) | High-level layers, `.fit()` does the loop for you |

Rule of thumb: **tabular → Scikit-Learn**, **research/flexibility → PyTorch**, **production/deployment → TF/Keras**.

---

## 1. Scikit-Learn

The standard library for classical ML. Built on NumPy/SciPy. Everything follows the same **Estimator API**.

### Core pattern
```python
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = RandomForestClassifier(n_estimators=100)
model.fit(X_train, y_train)            # train
preds = model.predict(X_test)          # infer
print(accuracy_score(y_test, preds))   # evaluate
```

### Must-know API
- `.fit(X, y)` → train · `.predict(X)` → infer · `.predict_proba(X)` → probabilities
- `.transform(X)` / `.fit_transform(X)` → for preprocessors (scalers, encoders)
- `.score(X, y)` → quick metric

### Must-know pieces
- **Models**: `LinearRegression`, `LogisticRegression`, `RandomForest*`, `GradientBoosting*`, `SVC`, `KMeans`, `KNeighbors*`
- **Preprocessing**: `StandardScaler`, `OneHotEncoder`, `LabelEncoder`
- **Pipeline**: chain steps so preprocessing + model travel together (avoids data leakage)
  ```python
  from sklearn.pipeline import Pipeline
  from sklearn.preprocessing import StandardScaler
  pipe = Pipeline([("scale", StandardScaler()), ("clf", LogisticRegression())])
  pipe.fit(X_train, y_train)
  ```
- **Validation**: `cross_val_score`, `GridSearchCV` (hyperparameter tuning)
- **Metrics**: `accuracy_score`, `f1_score`, `confusion_matrix`, `roc_auc_score`, `mean_squared_error`, `r2_score`

### The serious-person talking points
- Always **split train/test** (and use a **validation set** or **cross-validation** for tuning).
- **Scale features** for distance-based models (SVM, KNN) and linear models.
- Watch for **data leakage**: fit scalers/encoders on *training* data only — Pipelines handle this.
- Not for deep learning or GPUs — use PyTorch/TF for that.

---

## 2. PyTorch

The dominant deep-learning framework for research. Dynamic ("define-by-run") graphs, very Pythonic. You control the training loop.

### Core concepts
- **Tensor**: like a NumPy array but GPU-capable and tracks gradients.
- **autograd**: automatic differentiation (`loss.backward()` computes gradients).
- **`nn.Module`**: base class for models/layers.
- **Optimizer**: updates weights (`torch.optim.Adam`, `SGD`).

### Define a model
```python
import torch
import torch.nn as nn

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc1 = nn.Linear(784, 128)
        self.fc2 = nn.Linear(128, 10)
    def forward(self, x):
        x = torch.relu(self.fc1(x))
        return self.fc2(x)

model = Net()
```

### The training loop (this is the thing to memorize)
```python
optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
criterion = nn.CrossEntropyLoss()

for epoch in range(epochs):
    for X, y in dataloader:
        optimizer.zero_grad()      # 1. reset gradients
        out = model(X)             # 2. forward pass
        loss = criterion(out, y)   # 3. compute loss
        loss.backward()            # 4. backprop
        optimizer.step()           # 5. update weights
```
> Remember the 5 steps: **zero_grad → forward → loss → backward → step**.

### Must-know API
- **Data**: `Dataset` + `DataLoader` (batching, shuffling)
- **Layers**: `nn.Linear`, `nn.Conv2d`, `nn.LSTM`, `nn.Transformer`, `nn.Dropout`, `nn.BatchNorm*`
- **Losses**: `CrossEntropyLoss` (classification), `MSELoss` (regression)
- **Device**: `model.to("cuda")` and move tensors to GPU the same way
- **Modes**: `model.train()` vs `model.eval()` (toggles dropout/batchnorm); wrap inference in `with torch.no_grad():`
- **Save/load**: `torch.save(model.state_dict(), "m.pt")` / `model.load_state_dict(torch.load("m.pt"))`

### Serious-person talking points
- Ecosystem: **torchvision / torchaudio / torchtext**, **Hugging Face** (transformers), **PyTorch Lightning** (removes boilerplate).
- Always `optimizer.zero_grad()` each step — gradients accumulate otherwise.
- Switch to `model.eval()` + `no_grad()` for validation/inference.

---

## 3. TensorFlow / Keras

Google's framework. **Keras** is the high-level API (now the default way to use TF). Great for fast development and **production/deployment**.

### Core pattern (Sequential API)
```python
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

model = keras.Sequential([
    layers.Dense(128, activation="relu", input_shape=(784,)),
    layers.Dropout(0.2),
    layers.Dense(10, activation="softmax"),
])

model.compile(optimizer="adam",
              loss="sparse_categorical_crossentropy",
              metrics=["accuracy"])

model.fit(X_train, y_train, epochs=10, validation_split=0.2)
model.evaluate(X_test, y_test)
preds = model.predict(X_test)
```
> Keras workflow = **build → compile → fit → evaluate → predict**. No manual loop.

### Three ways to build a model
- **Sequential**: simple linear stack of layers (above).
- **Functional API**: multi-input/output, branching — most common for real work.
- **Subclassing** (`keras.Model`): full control, PyTorch-like.

### Must-know API
- **Layers**: `Dense`, `Conv2D`, `LSTM`, `Embedding`, `Dropout`, `BatchNormalization`
- **`compile(optimizer, loss, metrics)`** then **`fit(...)`**
- **Callbacks**: `EarlyStopping`, `ModelCheckpoint`, `TensorBoard`
- **Data**: `tf.data.Dataset` for efficient input pipelines
- **Save/load**: `model.save("m.keras")` / `keras.models.load_model("m.keras")`

### Serious-person talking points
- Keras 3 is now **multi-backend** (can run on TensorFlow, JAX, or PyTorch).
- **Deployment** is TF's strength: **TF Serving** (servers), **TF Lite** (mobile/edge), **TensorFlow.js** (browser).
- **TensorBoard** for visualizing training.
- `loss="sparse_categorical_crossentropy"` for integer labels vs `"categorical_crossentropy"` for one-hot.

---

## PyTorch vs TensorFlow/Keras — the comparison they'll ask about

| | PyTorch | TensorFlow/Keras |
|---|---|---|
| Graph | Dynamic (eager) | Eager by default; `@tf.function` for graph speed |
| Training loop | You write it | `.fit()` handles it |
| Feel | Pythonic, flexible | High-level, batteries-included |
| Strength | Research, customization | Production, deployment, mobile/edge |
| Ecosystem | Hugging Face, Lightning | TF Serving, TF Lite, TF.js |

Both are now functionally equivalent for most tasks. **PyTorch dominates research; TF/Keras shines in production deployment.**

---

## Universal concepts (frame any ML conversation with these)

- **Train / Validation / Test split** — train on one, tune on another, report on a held-out third.
- **Overfitting** — model memorizes training data, fails to generalize. Combat with: more data, **regularization** (L1/L2, dropout), early stopping.
- **Underfitting** — model too simple to capture patterns.
- **Hyperparameters** — set by you (learning rate, layers, epochs); tuned, not learned.
- **Loss function** — what you minimize. **Optimizer** — how you minimize it (Adam is the safe default).
- **Epoch** (one full pass over data) vs **batch** (subset per update).
- **Metrics ≠ loss** — you optimize loss but judge with metrics (accuracy, F1, RMSE…).
- **Classification vs Regression** — predicting categories vs continuous values.
