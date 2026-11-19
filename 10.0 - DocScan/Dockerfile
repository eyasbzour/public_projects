# DocScan: photos of Arabic documents -> reviewed, editable Word/PDF/PNG with an official header template.
# Build:  docker build -t docscan .                       (Tesseract + Claude + Google Vision)
#         docker build -t docscan --build-arg WITH_EASYOCR=1 --build-arg WITH_PADDLE=1 --build-arg WITH_NUQTA=1 .   (all engines)
# Run:    docker run -d -p 8000:8000 -v docscan-data:/app/data -v docscan-templates:/app/templates docscan
# bookworm (LibreOffice 7.4): the whole stack, optional engines included, was tested on it
FROM python:3.12-slim-bookworm

ARG WITH_EASYOCR=0
ARG WITH_PADDLE=0
ARG WITH_NUQTA=0

RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-ara tesseract-ocr-eng \
        libreoffice-writer-nogui poppler-utils \
        fonts-noto-core fonts-noto-extra fonts-hosny-amiri fonts-dejavu fonts-liberation \
        curl ca-certificates libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Tesseract model choices: fast / standard / best (Arabic + English)
RUN set -e; for m in fast standard best; do \
      mkdir -p /opt/tessdata/$m; \
      repo=tessdata_$m; [ "$m" = standard ] && repo=tessdata; \
      for l in ara eng; do curl -fsSL -o /opt/tessdata/$m/$l.traineddata \
        https://raw.githubusercontent.com/tesseract-ocr/$repo/main/$l.traineddata; done; \
    done

WORKDIR /app
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt

# Optional engines. CPU-only torch keeps EasyOCR to about 1 GB instead of several GB of CUDA libraries.
ENV EASYOCR_MODELS=/opt/easyocr
RUN if [ "$WITH_EASYOCR" = "1" ]; then \
      pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu \
      && pip install --no-cache-dir easyocr; \
    fi
RUN if [ "$WITH_PADDLE" = "1" ]; then pip install --no-cache-dir paddlepaddle==3.3.1 paddleocr==3.7.0; fi
# Nuqta (needs torch: comes with WITH_EASYOCR, or installed here CPU-only) and a Transformers new enough for its model
RUN if [ "$WITH_NUQTA" = "1" ]; then       python -c "import torch" 2>/dev/null || pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu;       pip install --no-cache-dir "transformers>=5.23" accelerate;     fi

# Download the engines' Arabic models now, through the engine code itself (same models and settings
# as at run time), so the server can read pages without internet.
COPY server/engines server/engines
RUN cd server \
    && if [ "$WITH_EASYOCR" = "1" ]; then python -c "from engines import easyocr_engine as e; e._get_reader()"; fi \
    && if [ "$WITH_PADDLE" = "1" ]; then python -c "from engines import paddle_engine as e; e._get()"; fi     && if [ "$WITH_NUQTA" = "1" ]; then python -c "from engines import nuqta_engine as e; e._get()"; fi

COPY server server
COPY web web
COPY templates templates

ENV DOCSCAN_DATA=/app/data DOCSCAN_TEMPLATES=/app/templates
EXPOSE 8000
WORKDIR /app/server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
