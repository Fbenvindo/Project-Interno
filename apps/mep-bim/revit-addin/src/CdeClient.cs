using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading.Tasks;

namespace SmartEasyBIM.Revit
{
    /// <summary>Ligação de um arquivo do Revit a um documento do CDE (guardada por projeto).</summary>
    internal sealed class CdeLink
    {
        public string Url;
        public long EmpId;
        public string EmpNome;
        public long DocId;
        public string DocCodigo;
        public bool Ifc4;
        public bool OnlyView;
        public bool Share = true;
        public string Finalidade = "S1";
    }

    /// <summary>Documento do CDE (resumo).</summary>
    internal sealed class CdeDoc
    {
        public long Id;
        public string Codigo, Titulo, Tipo, Disciplina, Revisao, Estado, ArquivoNome;
        public override string ToString() => $"{Codigo} · {Revisao} · {Titulo}";
    }

    /// <summary>
    /// Cliente do SmartEasyBIM CDE (servidor do escritório): login, empreendimentos, documentos,
    /// envio de arquivo como nova revisão, estados e interferências. A sessão e as ligações de cada
    /// projeto ficam em %APPDATA%\SmartEasyBIM\revit-cde.json.
    /// </summary>
    internal sealed class CdeClient
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        private static string StoreFile => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SmartEasyBIM", "revit-cde.json");

        public string Url { get; private set; }
        public string Token { get; private set; }
        public string UserName { get; private set; }
        public string UserEmail { get; private set; }
        public bool LoggedIn => !string.IsNullOrEmpty(Token);
        private readonly Dictionary<string, CdeLink> _links = new Dictionary<string, CdeLink>();

        public static CdeClient Load()
        {
            var c = new CdeClient { Url = "http://localhost:4000" };
            try
            {
                if (!File.Exists(StoreFile)) return c;
                var o = new JObj(JsonReader.Parse(File.ReadAllText(StoreFile, Encoding.UTF8)));
                c.Url = o.Str("url") ?? c.Url;
                c.Token = o.Str("token");
                c.UserName = o.Str("nome");
                c.UserEmail = o.Str("email");
                var links = o.Obj("projetos");
                foreach (var key in (o["projetos"] as Dictionary<string, object> ?? new Dictionary<string, object>()).Keys)
                {
                    var l = links.Obj(key);
                    c._links[key] = new CdeLink
                    {
                        Url = l.Str("url"),
                        EmpId = l.Long("empId"),
                        EmpNome = l.Str("empNome"),
                        DocId = l.Long("docId"),
                        DocCodigo = l.Str("docCodigo"),
                        Ifc4 = l.Bool("ifc4"),
                        OnlyView = l.Bool("soVista"),
                        Share = !l.Has("compartilhar") || l.Bool("compartilhar"),
                        Finalidade = l.Str("finalidade") ?? "S1",
                    };
                }
            }
            catch
            {
                /* arquivo ilegível: começa do zero */
            }
            return c;
        }

        public void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(StoreFile));
            var sw = new StringWriter(CultureInfo.InvariantCulture);
            var w = new JsonWriter(sw);
            w.BeginObject().Prop("url", Url).Prop("token", Token).Prop("nome", UserName).Prop("email", UserEmail);
            w.Name("projetos").BeginObject();
            foreach (var kv in _links)
            {
                var l = kv.Value;
                w.Name(kv.Key).BeginObject()
                    .Prop("url", l.Url).Name("empId").Value(l.EmpId).Prop("empNome", l.EmpNome).Name("docId").Value(l.DocId).Prop("docCodigo", l.DocCodigo)
                    .Prop("ifc4", l.Ifc4).Prop("soVista", l.OnlyView).Prop("compartilhar", l.Share).Prop("finalidade", l.Finalidade)
                    .EndObject();
            }
            w.EndObject().EndObject();
            File.WriteAllText(StoreFile, sw.ToString(), new UTF8Encoding(false));
        }

        /// <summary>Ligação salva do projeto (do último envio).</summary>
        public CdeLink LinkOf(string projectKey) => _links.TryGetValue(projectKey, out var l) ? l : null;
        public void SetLink(string projectKey, CdeLink l) { _links[projectKey] = l; Save(); }

        public void Logout()
        {
            Token = null;
            UserName = null;
            Save();
        }

        // ---- HTTP ---------------------------------------------------------------------------------
        private static string Trim(string url) => (url ?? "").Trim().TrimEnd('/');

        /// <summary>Executa fora da thread da interface (evita travar/deadlock no Revit).</summary>
        private static T Run<T>(Func<Task<T>> f) => Task.Run(f).GetAwaiter().GetResult();

        private object Call(string method, string path, string jsonBody = null)
        {
            return Run(async () =>
            {
                using (var req = new HttpRequestMessage(new HttpMethod(method), Trim(Url) + path))
                {
                    if (LoggedIn) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
                    if (jsonBody != null) req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
                    HttpResponseMessage r;
                    try
                    {
                        r = await Http.SendAsync(req).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        throw new Exception($"Não foi possível falar com o CDE em {Url}: {ex.GetBaseException().Message}");
                    }
                    var text = await r.Content.ReadAsStringAsync().ConfigureAwait(false);
                    object data = null;
                    try { data = string.IsNullOrEmpty(text) ? null : JsonReader.Parse(text); }
                    catch { data = null; }
                    if ((int)r.StatusCode == 401 && path != "/api/auth/login")
                    {
                        Token = null;
                        Save();
                        throw new Exception("Sessão do CDE expirada: entre de novo.");
                    }
                    if (!r.IsSuccessStatusCode)
                        throw new Exception(new JObj(data).Str("error") ?? $"Erro {(int)r.StatusCode} no CDE.");
                    return data;
                }
            });
        }

        private static string Body(Action<JsonWriter> build)
        {
            var sw = new StringWriter(CultureInfo.InvariantCulture);
            var w = new JsonWriter(sw);
            w.BeginObject();
            build(w);
            w.EndObject();
            return sw.ToString();
        }

        // ---- API ----------------------------------------------------------------------------------
        public void Login(string url, string email, string password)
        {
            Url = Trim(url);
            Token = null;
            var r = new JObj(Call("POST", "/api/auth/login", Body(w => w.Prop("email", email).Prop("password", password))));
            Token = r.Str("token");
            UserName = r.Obj("user").Str("name");
            UserEmail = r.Obj("user").Str("email");
            Save();
        }

        public List<KeyValuePair<long, string>> Empreendimentos() =>
            ((List<object>)Call("GET", "/api/empreendimentos")).Select(o => new JObj(o)).Select(o => new KeyValuePair<long, string>(o.Long("id"), o.Str("nome"))).ToList();

        public List<CdeDoc> Documentos(long empId) =>
            new JObj(Call("GET", $"/api/cde/{empId}")).Arr("documentos").Select(Doc).ToList();

        private static CdeDoc Doc(JObj d) => new CdeDoc
        {
            Id = d.Long("id"),
            Codigo = d.Str("codigo"),
            Titulo = d.Str("titulo"),
            Tipo = d.Str("tipo"),
            Disciplina = d.Str("disciplina"),
            Revisao = d.Str("revisao"),
            Estado = d.Str("estado"),
            ArquivoNome = d.Str("arquivo_nome"),
        };

        public CdeDoc CriarDocumento(long empId, string titulo, string disciplina, string nivel) =>
            Doc(new JObj(Call("POST", $"/api/cde/{empId}/documentos", Body(w => w.Prop("titulo", titulo).Prop("tipo", "M3").Prop("disciplina", disciplina).Prop("nivel", string.IsNullOrWhiteSpace(nivel) ? "ZZ" : nivel).Prop("origem", "revit")))));

        /// <summary>Envia o arquivo como nova versão do documento (link assinado → PUT → confirmação).</summary>
        public CdeDoc Enviar(long docId, string file, string descricao, Action<string> progress = null)
        {
            var name = Path.GetFileName(file);
            var size = new FileInfo(file).Length;
            var u = new JObj(Call("POST", $"/api/cde/documentos/{docId}/upload", Body(w => w.Prop("nome", name).Prop("content_type", "application/x-step").Name("tamanho").Value(size))));
            progress?.Invoke($"Enviando {name} ({size / 1048576.0:0.0} MB)…");
            Run(async () =>
            {
                using (var fs = File.OpenRead(file))
                using (var req = new HttpRequestMessage(new HttpMethod(u.Str("method") ?? "PUT"), u.Str("url")))
                {
                    req.Content = new StreamContent(fs, 1 << 20);
                    req.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                    var r = await Http.SendAsync(req).ConfigureAwait(false);
                    if (!r.IsSuccessStatusCode) throw new Exception($"Falha no envio do arquivo ({(int)r.StatusCode}).");
                    return true;
                }
            });
            return Doc(new JObj(Call("POST", $"/api/cde/documentos/{docId}/arquivo", Body(w => w.Prop("key", u.Str("key")).Prop("nome", name).Prop("content_type", "application/x-step").Prop("descricao", descricao)))));
        }

        public CdeDoc MudarEstado(long docId, string estado, string finalidade, string descricao) =>
            Doc(new JObj(Call("POST", $"/api/cde/documentos/{docId}/estado", Body(w => w.Prop("estado", estado).Prop("finalidade", finalidade).Prop("descricao", descricao)))));

        /// <summary>Interferências em aberto das análises mais recentes que envolvem o documento.</summary>
        public List<ClashItem> Pendencias(long empId, long docId)
        {
            var r = new JObj(Call("GET", $"/api/clash/{empId}/pendencias?documentos={docId}"));
            var list = new List<ClashItem>();
            foreach (var a in r.Arr("analises"))
            {
                var an = a.Obj("analise");
                foreach (var c in a.Arr("interferencias")) list.Add(ClashItem.From(c, an.Long("id"), an.Str("nome"), docId));
            }
            return list;
        }

        public void AtualizarInterferencia(long analiseId, long clashId, string estado, string comentario) =>
            Call("PATCH", $"/api/clash/analises/{analiseId}/interferencias", Body(w =>
            {
                w.Name("ids").BeginArray().Value(clashId).EndArray();
                if (estado != null) w.Prop("estado", estado);
                if (!string.IsNullOrWhiteSpace(comentario)) w.Prop("comentario", comentario.Trim());
                w.Prop("origem", "revit");
            }));
    }

    /// <summary>Elemento de uma interferência.</summary>
    internal sealed class ClashElement
    {
        public string GlobalId, Tipo, Nome, Pavimento, Codigo;
        public long DocId;
        public static ClashElement From(JObj e) => new ClashElement
        {
            GlobalId = e.Str("globalId"),
            Tipo = (e.Str("tipo") ?? "").Replace("IFC", ""),
            Nome = e.Str("nome"),
            Pavimento = e.Str("pavimento"),
            Codigo = e.Str("codigo"),
            DocId = e.Long("documento_id"),
        };
    }

    /// <summary>Interferência em aberto (do ponto de vista do documento deste projeto).</summary>
    internal sealed class ClashItem
    {
        public long Id, AnaliseId;
        public string AnaliseNome;
        public int Numero;
        public string Tipo, Estado, Situacao, Pavimento, Responsavel;
        public double Distancia;
        /// <summary>Ponto em coordenadas do IFC (metros, Z para cima).</summary>
        public double[] PontoIfc;
        /// <summary>Elemento deste projeto e o outro.</summary>
        public ClashElement Mine, Other;
        public List<string> Comentarios = new List<string>();

        public string Medida => Tipo == "colisao" ? $"sobreposição ~{Math.Abs(Distancia) * 100:0.0} cm" : $"distância {Distancia * 100:0.0} cm";

        public static ClashItem From(JObj c, long analiseId, string analiseNome, long myDoc)
        {
            var a = ClashElement.From(c.Obj("a"));
            var b = ClashElement.From(c.Obj("b"));
            var p = c.Raw("ponto").Select(x => x is double d ? d : 0).ToArray();
            var item = new ClashItem
            {
                Id = c.Long("id"),
                AnaliseId = analiseId,
                AnaliseNome = analiseNome,
                Numero = (int)c.Num("numero"),
                Tipo = c.Str("tipo"),
                Estado = c.Str("estado"),
                Situacao = c.Str("situacao"),
                Pavimento = c.Str("pavimento"),
                Responsavel = c.Str("responsavel_nome"),
                Distancia = c.Num("distancia"),
                // Cena do web-ifc (Y para cima) → IFC (Z para cima).
                PontoIfc = p.Length == 3 ? new[] { p[0], -p[2], p[1] } : null,
                Mine = a.DocId == myDoc ? a : b,
                Other = a.DocId == myDoc ? b : a,
            };
            foreach (var k in c.Arr("comentarios"))
            {
                var when = DateTime.TryParse(k.Str("created_at"), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var dt) ? dt.ToLocalTime().ToString("dd/MM/yyyy HH:mm") : "";
                item.Comentarios.Add($"{k.Str("autor")} · {when}: {k.Str("texto")}");
            }
            return item;
        }
    }
}
