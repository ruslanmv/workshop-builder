import multiprocessing, os

bind = f"0.0.0.0:{os.getenv('PORT','5000')}"
workers = int(os.getenv("WEB_CONCURRENCY", multiprocessing.cpu_count()))
threads = 1
timeout = 120
worker_class = "uvicorn.workers.UvicornWorker"
accesslog = "-"
errorlog = "-"
loglevel = os.getenv("LOG_LEVEL","info").lower()
