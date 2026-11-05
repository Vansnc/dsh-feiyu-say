#!/usr/bin/env python3
"""RVC 换声（dsh-qq-voice 用）。

在 rvc 目录（cwd）里跑，把一段音频换成指定模型的嗓子。
参数：src out model_path index_path index_rate protect
"""
import sys

from rvc_python.infer import RVCInference


def main():
    src, out, model, index, index_rate, protect = sys.argv[1:7]
    rvc = RVCInference(device="cpu")
    rvc.load_model(model, version="v2", index_path=index or None)
    rvc.set_params(index_rate=float(index_rate), protect=float(protect))
    rvc.infer_file(src, out)


if __name__ == "__main__":
    main()
