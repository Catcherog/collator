"""
CLIP 图文相似度推理服务
用法：python clip_service.py <image_path> <texts_json>
输出：JSON，包含 similarities / bestMatch / bestScore
"""

import sys
import json
import os


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: clip_service.py <image_path> <texts_json>"}), file=sys.stderr)
        sys.exit(1)

    image_path = sys.argv[1]
    texts_json = sys.argv[2]

    try:
        texts = json.loads(texts_json)
    except Exception as e:
        print(json.dumps({"error": f"Invalid texts JSON: {str(e)}"}), file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(image_path):
        print(json.dumps({"error": f"Image not found: {image_path}"}), file=sys.stderr)
        sys.exit(1)

    try:
        import torch
        import open_clip
        from PIL import Image

        model, _, preprocess = open_clip.create_model_and_transforms('ViT-B-32', pretrained='openai')
        tokenizer = open_clip.get_tokenizer('ViT-B-32')

        device = "cpu"
        model = model.to(device)
        model.eval()

        image = preprocess(Image.open(image_path).convert('RGB')).unsqueeze(0).to(device)
        text_tokens = tokenizer(texts).to(device)

        with torch.no_grad():
            image_features = model.encode_image(image)
            text_features = model.encode_text(text_tokens)
            image_features /= image_features.norm(dim=-1, keepdim=True)
            text_features /= text_features.norm(dim=-1, keepdim=True)
            similarity = (image_features @ text_features.T).squeeze(0)

        similarities = similarity.cpu().numpy().tolist()
        best_idx = int(similarity.argmax().item())
        best_score = float(similarities[best_idx])

        result = {
            "similarities": similarities,
            "bestMatch": best_idx,
            "bestScore": best_score,
            "texts": texts
        }
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
