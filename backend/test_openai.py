# test_openai.py — run this to verify your setup
from openai import AzureOpenAI
import os
from dotenv import load_dotenv

load_dotenv()

client = AzureOpenAI(
    azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT"),
    api_key=os.getenv("AZURE_OPENAI_KEY"),
    api_version=os.getenv("AZURE_OPENAI_API_VERSION"),
)

response = client.chat.completions.create(
    model=os.getenv("AZURE_OPENAI_DEPLOYMENT"),  # deployment name, not model name
    messages=[
        {"role": "system", "content": "You are a SQL expert."},
        {"role": "user", "content": "Write a SELECT query to count patients by gender."},
    ],
    temperature=0,  # deterministic output for SQL generation
)

print(response.choices[0].message.content)