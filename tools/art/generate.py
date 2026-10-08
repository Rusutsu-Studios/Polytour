"""Queue FLUX.2 klein 9B (distilled) jobs on the local ComfyUI API.

usage: python gen.py prompts.json outdir [--dtype fp8_e4m3fn]
prompts.json: [{"id": "a1", "prompt": "...", "seed": 1}, ...]
A job with "source": "path.png" edits that image (FLUX.2 reference editing)
instead of generating from scratch; the prompt then describes the change.
"""
import json
import sys
import time
import urllib.parse
import urllib.request

API = "http://127.0.0.1:8188"
W, H = 1344, 768


def graph(prompt, seed, prefix, dtype, source=None):
    nodes = {
        "70": {"class_type": "UNETLoader", "inputs": {"unet_name": "flux-2-klein-9b.safetensors", "weight_dtype": dtype}},
        "71": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen_3_8b_fp8mixed.safetensors", "type": "flux2"}},
        "72": {"class_type": "VAELoader", "inputs": {"vae_name": "flux2-vae.safetensors"}},
        "74": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["71", 0]}},
        "76": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["74", 0]}},
        "63": {"class_type": "CFGGuider", "inputs": {"model": ["70", 0], "positive": ["74", 0], "negative": ["76", 0], "cfg": 1.0}},
        "73": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "61": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "62": {"class_type": "Flux2Scheduler", "inputs": {"steps": 4, "width": W, "height": H}},
        "66": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": W, "height": H, "batch_size": 1}},
        "64": {"class_type": "SamplerCustomAdvanced", "inputs": {"noise": ["73", 0], "guider": ["63", 0], "sampler": ["61", 0], "sigmas": ["62", 0], "latent_image": ["66", 0]}},
        "65": {"class_type": "VAEDecode", "inputs": {"samples": ["64", 0], "vae": ["72", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["65", 0], "filename_prefix": prefix}},
    }
    if source:
        # The reference latent conditions both prompts, as in ComfyUI's klein edit template.
        nodes["80"] = {"class_type": "LoadImage", "inputs": {"image": source}}
        nodes["124"] = {"class_type": "VAEEncode", "inputs": {"pixels": ["80", 0], "vae": ["72", 0]}}
        nodes["125"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["74", 0], "latent": ["124", 0]}}
        nodes["123"] = {"class_type": "ReferenceLatent", "inputs": {"conditioning": ["76", 0], "latent": ["124", 0]}}
        nodes["63"]["inputs"]["positive"] = ["125", 0]
        nodes["63"]["inputs"]["negative"] = ["123", 0]
    return nodes


def upload(path):
    """Upload a local image to ComfyUI's input folder and return its name there."""
    import os
    import uuid
    boundary = uuid.uuid4().hex
    crlf = chr(13) + chr(10)
    head = (f"--{boundary}{crlf}Content-Disposition: form-data; name=\"image\"; "
            f"filename=\"{os.path.basename(path)}\"{crlf}Content-Type: image/png{crlf}{crlf}")
    tail = (f"{crlf}--{boundary}{crlf}Content-Disposition: form-data; name=\"overwrite\"{crlf}{crlf}"
            f"true{crlf}--{boundary}--{crlf}")
    body = head.encode() + open(path, "rb").read() + tail.encode()
    request = urllib.request.Request(API + "/upload/image", body, {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return json.load(urllib.request.urlopen(request))["name"]


def post(path, body):
    request = urllib.request.Request(API + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(request))


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    dtype = sys.argv[sys.argv.index("--dtype") + 1] if "--dtype" in sys.argv else "default"
    queued = {}
    for job in jobs:
        source = upload(job["source"]) if "source" in job else None
        prompt_id = post("/prompt", {"prompt": graph(job["prompt"], job["seed"], f"polytour/{job['id']}", dtype, source)})["prompt_id"]
        queued[prompt_id] = job["id"]
    start = time.time()
    while queued:
        time.sleep(2)
        for prompt_id in list(queued):
            history = json.load(urllib.request.urlopen(f"{API}/history/{prompt_id}"))
            if prompt_id not in history:
                continue
            entry = history[prompt_id]
            if entry.get("status", {}).get("status_str") == "error":
                print("ERROR", queued.pop(prompt_id), json.dumps(entry["status"])[:500], flush=True)
                continue
            for image in entry["outputs"]["9"]["images"]:
                query = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image["subfolder"], "type": "output"})
                data = urllib.request.urlopen(f"{API}/view?{query}").read()
                open(f"{out}/{queued[prompt_id]}.png", "wb").write(data)
            print(f"done {queued.pop(prompt_id)} at {time.time() - start:.0f}s", flush=True)


main()
