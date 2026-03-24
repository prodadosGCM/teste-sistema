import streamlit as st
import pandas as pd
from io import BytesIO

# Configuração da Página
st.set_page_config(page_title="RAS Digital", layout="wide", page_icon="🛡️")

# --- CSS DINÂMICO (ADAPTÁVEL) ---
st.markdown("""
    <style>
    /* Importando fonte Inter */
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');

    html, body, [class*="css"] {
        font-family: 'Inter', sans-serif;
    }

    /* Estilização dos Metrics - Fundo semi-transparente para adaptar ao tema */
    [data-testid="stMetric"] {
        background-color: rgba(128, 128, 128, 0.1);
        padding: 15px;
        border-radius: 12px;
        border-left: 5px solid #3b82f6;
    }

    /* Estilização dos Expanders */
    .streamlit-expanderHeader {
        background-color: rgba(128, 128, 128, 0.05) !important;
        border-radius: 8px !important;
        margin-bottom: 5px;
        font-weight: 600;
    }

    /* Botão de Download Moderno */
    .stDownloadButton button {
        width: 100%;
        background-color: #3b82f6 !important;
        color: white !important;
        border-radius: 8px !important;
        transition: all 0.3s ease;
    }
    
    .stDownloadButton button:hover {
        opacity: 0.8;
        transform: translateY(-2px);
    }
    </style>
    """, unsafe_allow_html=True)

# --- CABEÇALHO ---
st.title("🛡️ Sistema Inteligente RAS")
st.write("Distribuição automática por ordem de chegada.")
st.divider()

file = st.file_uploader("📂 Arraste sua planilha (.xlsx ou .csv)", type=['xlsx', 'csv'])

if file:
    # Leitura dos dados
    df = pd.read_excel(file) if file.name.endswith('xlsx') else pd.read_csv(file)
    df.columns = [c.strip() for c in df.columns]

    # Ordenação por prioridade de tempo
    df['Carimbo de data/hora'] = pd.to_datetime(df['Carimbo de data/hora'], dayfirst=True)
    df = df.sort_values(by='Carimbo de data/hora')

    # --- BARRA LATERAL ---
    st.sidebar.markdown("### ⚙️ Configurações de Vagas")
    col_1_opcao = '1º OPÇÃO: ESCOLHA O DIA DO RAS:'
    dias_detectados = sorted(df[col_1_opcao].dropna().unique().tolist())

    dict_limites = {}
    for dia in dias_detectados:
        dict_limites[dia] = st.sidebar.number_input(f"{dia}", min_value=0, value=10)

    # --- LÓGICA DE ALOCAÇÃO ---
    controle_vagas = {dia: 0 for dia in dias_detectados}
    lista_alocados = []
    
    colunas_pref = [
        '1º OPÇÃO: ESCOLHA O DIA DO RAS:', '2º OPÇÃO: ESCOLHA O DIA DO RAS:',
        '3º OPÇÃO: ESCOLHA O DIA DO RAS:', '4º OPÇÃO: ESCOLHA O DIA DO RAS:',
        '5º OPÇÃO: ESCOLHA O DIA DO RAS:'
    ]

    for _, row in df.iterrows():
        alocado = False
        for i, col in enumerate(colunas_pref, 1):
            escolha = str(row.get(col, "")).strip()
            if escolha in dict_limites and controle_vagas[escolha] < dict_limites[escolha]:
                controle_vagas[escolha] += 1
                lista_alocados.append({
                    "Ordem": controle_vagas[escolha],
                    "Inscrição": row['Carimbo de data/hora'],
                    "NOME DE GUERRA": row['NOME DE GUERRA'],
                    "PLANTÃO": row['PLANTÃO'],
                    "DIA": escolha
                })
                alocado = True
                break

    # --- DASHBOARD DE MÉTRICAS ---
    st.subheader("📊 Resumo de Vagas")
    m_cols = st.columns(len(dias_detectados))
    for idx, dia in enumerate(dias_detectados):
        # O metric já muda de cor sozinho no Streamlit conforme o tema
        m_cols[idx].metric(dia, f"{controle_vagas[dia]} / {dict_limites[dia]}")

    st.divider()

    # --- EXIBIÇÃO EM EXPANDERS ---
    df_final = pd.DataFrame(lista_alocados)
    
    if not df_final.empty:
        st.subheader("📋 Relação de Escala")
        for dia in dias_detectados:
            df_dia = df_final[df_final['DIA'] == dia].copy()
            
            with st.expander(f"📍 {dia} — {len(df_dia)} militares"):
                if not df_dia.empty:
                    df_dia['Inscrição'] = df_dia['Inscrição'].dt.strftime('%H:%M:%S')
                    st.dataframe(
                        df_dia[["Ordem", "Inscrição", "NOME DE GUERRA", "PLANTÃO"]],
                        use_container_width=True,
                        hide_index=True
                    )
                else:
                    st.info("Nenhuma vaga preenchida para este dia.")

        # --- BOTÃO DE DOWNLOAD ---
        st.sidebar.divider()
        output = BytesIO()
        with pd.ExcelWriter(output, engine='xlsxwriter') as writer:
            df_final.to_excel(writer, index=False)
        
        st.sidebar.download_button(
            "📥 Baixar Escala Final",
            data=output.getvalue(),
            file_name="escala_ras.xlsx"
        )