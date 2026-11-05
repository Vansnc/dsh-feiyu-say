#!/usr/bin/env python3
"""RVC 换声（dsh-feiyu-say 用）。

在 rvc 目录（cwd）里跑，把一段音频换成指定模型的嗓子。
参数：src out model_path index_path index_rate protect
"""
import os
import sys

# torch 2.6+ 的 torch.load 默认 weights_only=True，fairseq 的 hubert 权重（含 Dictionary 类）
# 会因此加载失败。官方开关：改回旧行为。
os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

import torch

# ⚠️ rvc_python 的 device_config() 会忽略 device="cpu"，只要 torch 有 MPS 就强制用 MPS，
#    而 MPS 上跑 RVC 会崩（NotImplemented / 精度问题）。这里把 MPS 判成不可用，强制回 CPU。
try:
    torch.backends.mps.is_available = lambda: False
except Exception:
    pass

# 双保险：即使上游直接调 torch.load，也把 weights_only 默认成 False
_orig_load = torch.load


def _load(*a, **kw):
    kw.setdefault("weights_only", False)
    return _orig_load(*a, **kw)


torch.load = _load

from rvc_python.infer import RVCInference  # noqa: E402


def infer_file(rvc, src, out):
    """自己调 vc_single 并解包，绕开 rvc-python 0.1.5 的 infer_file 元组 bug。"""
    import scipy.io.wavfile as wavfile

    info = rvc.models[rvc.current_model]
    res = rvc.vc.vc_single(
        sid=0,
        input_audio_path=src,
        f0_up_key=rvc.f0up_key,
        f0_file="",
        f0_method=rvc.f0method,
        file_index=info.get("index", ""),
        file_index2="",
        index_rate=rvc.index_rate,
        filter_radius=rvc.filter_radius,
        resample_sr=rvc.resample_sr,
        rms_mix_rate=rvc.rms_mix_rate,
        protect=rvc.protect,
    )
    wav, sr = res if isinstance(res, tuple) else (res, rvc.vc.tgt_sr)
    if isinstance(wav, str):
        # vc_single 把内部异常吞成了 ("错误信息", None)，这里抛出来
        raise RuntimeError("RVC vc_single 失败：" + wav)
    wavfile.write(out, sr, wav)


def main():
    src, out, model, index, index_rate, protect = sys.argv[1:7]
    rvc = RVCInference(device="cpu")
    rvc.load_model(model, version="v2", index_path=index or None)
    rvc.set_params(index_rate=float(index_rate), protect=float(protect))
    infer_file(rvc, src, out)


if __name__ == "__main__":
    main()
