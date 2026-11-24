from flask import Flask, request, send_file, jsonify
from dotenv import load_dotenv
from pathlib import Path
from io import BytesIO
from collections import Counter
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
 
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

app = Flask(__name__)
@app.post("/graficos")

def gerar_graficos():
    dados = request.get_json(silent=True) or {}
    atendimento =dados.get("atendimento", [])
    if not atendimento:
        return jsonify({"erro": "não existem dados suficientes para gerar graficos"}), 400
    servicos = Counter(item.get("servico", "Não informado") for item in atendimento)
    especies = Counter(item.get("especie", "Não infortmado")for item in atendimento)
    fig, axs = plt.subplots(1,2, figsize=(12,5))

    axs[0].bar(servicos.keys(), servicos.values())
    axs[0].set_title("atendimento por serviços")
    axs[0].set_ylabel("quantidade")
    axs[0].tick_params(axis="x", rotation=30)

    axs[1].pie(especies.values(), labels=especies.keys(), autopct="%1.1f%%", startangle=90)
    axs[1].set_title("Atendimento por especie")

    fig.tight_layout()
    buffer = BytesIO()
    fig.savefig(buffer, format="png", dpi=150)
    plt.close(fig)
    buffer.seek(0)
    return send_file(buffer, mimetype="image/png", as_attachment=False, download_name="graficos.png")

@app.post("/pdf")
def gerar_pdf():
    dados = request.get_json(silent=True) or {}
    atendimento = dados.get("atendimento", [])
    buffer = BytesIO()
    documento = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        rightMargin=28,
        leftMargin=28,
        topMargin=28,
        bottomMargin=28
    )
 
    estilos = getSampleStyleSheet()
 
    elementos = [
        Paragraph("Relatório de atendimentos - Petshop Manager", estilos["Title"]),
        Spacer(1, 18)
    ]
 
    tabela_dados = [
        ["Tutor", "Pet", "Espécie", "Serviço"]
    ]
 
    for item in atendimento:
 
        tabela_dados.append([
            str(item.get("tutor", "")),
            str(item.get("pet", "")),
            str(item.get("especie", "")),
            str(item.get("servico", ""))
        ])
 
    if not atendimento:
        tabela_dados.append(["-", "Nenhum atendimento cadastrado", "-", "-"])
 
    tabela = Table(
        tabela_dados,
        repeatRows=1,
        colWidths=[125, 90, 85, 150]
    )
 
    tabela.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#17324d")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#ccd3dc")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f2f5f8")]),
        ("PADDING", (0, 0), (-1, -1), 7)
    ]))
 
    elementos.append(tabela)
    documento.build(elementos)
    buffer.seek(0)
 
    return send_file(buffer,mimetype="application/pdf",as_attachment=True,download_name="relatorio-petshop.pdf")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT",5001)), debug=False)