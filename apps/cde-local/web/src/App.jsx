// Interface do CDE local: primeira configuração, login, empreendimentos, CDE de cada empreendimento
// e usuários (administrador). Navegação pelo endereço (#/emp/ID, #/usuarios, #/senha).
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Building2, KeyRound, LogOut, Plus, RefreshCw, Users } from 'lucide-react';
import { api, loadSession, saveSession, setOnExpired } from './api';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from './ui';
import CdeView from './CdeView';

const PERFIL = { admin: 'Administrador', coordenador: 'Coordenação', colaborador: 'Colaborador' };

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const on = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}
const go = (h) => {
  window.location.hash = h;
};

function Msg({ msg }) {
  if (!msg) return null;
  return <p className={`text-sm ${msg.startsWith('Erro') ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>;
}

function Centered({ title, subtitle, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">{title}</CardTitle>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </CardHeader>
        <CardContent className="space-y-3">{children}</CardContent>
      </Card>
    </div>
  );
}

function Setup({ onDone }) {
  const [f, setF] = useState({ empresa: '', nome: '', email: '', senha: '' });
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.setup(f);
      saveSession(r);
      onDone(r);
    } catch (err) {
      setMsg(`Erro: ${err.message}`);
    }
  };
  return (
    <Centered title="Configurar o CDE" subtitle="Crie o administrador. Depois ele cadastra os demais usuários.">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Nome do escritório (aparece no topo)">
          <Input value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} />
        </Field>
        <Field label="Seu nome">
          <Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} required />
        </Field>
        <Field label="E-mail (login)">
          <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </Field>
        <Field label="Senha (mínimo 6 caracteres)">
          <Input type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} required />
        </Field>
        <Button className="w-full">Criar administrador</Button>
        <Msg msg={msg} />
        <p className="text-xs text-gray-500">A primeira configuração só funciona no próprio computador do servidor.</p>
      </form>
    </Centered>
  );
}

function Login({ status, onDone }) {
  const [f, setF] = useState({ email: '', senha: '' });
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.login(f.email, f.senha);
      saveSession(r);
      onDone(r);
    } catch (err) {
      setMsg(`Erro: ${err.message}`);
    }
  };
  return (
    <Centered title={status?.nome || 'CDE'} subtitle="Ambiente Comum de Dados (ISO 19650)">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="E-mail">
          <Input type="email" autoFocus value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        </Field>
        <Field label="Senha">
          <Input type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} required />
        </Field>
        <Button className="w-full">Entrar</Button>
        <Msg msg={msg} />
      </form>
    </Centered>
  );
}

function Projects({ user }) {
  const [list, setList] = useState(null);
  const [novo, setNovo] = useState({ nome: '', cliente: '' });
  const [msg, setMsg] = useState(null);
  const [verConcluidos, setVerConcluidos] = useState(false);
  const canEdit = user.perfil === 'admin' || user.perfil === 'coordenador';
  const load = useCallback(() => api.projects().then(setList).catch((e) => setMsg(`Erro: ${e.message}`)), []);
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn, ok) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    }
  };
  const shown = (list || []).filter((e) => verConcluidos || e.status === 'ativo');
  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Novo empreendimento</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api.createProject(novo);
                  setNovo({ nome: '', cliente: '' });
                }, 'Empreendimento criado.');
              }}
            >
              <Field label="Nome" className="flex-1 min-w-[220px]">
                <Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required />
              </Field>
              <Field label="Cliente" className="flex-1 min-w-[180px]">
                <Input value={novo.cliente} onChange={(e) => setNovo({ ...novo, cliente: e.target.value })} />
              </Field>
              <Button>
                <Plus className="w-4 h-4 mr-1" /> Criar
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Empreendimentos</CardTitle>
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={verConcluidos} onChange={(e) => setVerConcluidos(e.target.checked)} /> mostrar concluídos
            </label>
            <Button variant="outline" size="sm" onClick={load} title="Atualizar">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {!list && <p className="p-4 text-sm text-gray-500">Carregando…</p>}
          {list && !shown.length && <p className="p-4 text-sm text-gray-400">Nenhum empreendimento{canEdit ? ': crie o primeiro acima' : ' ainda'}.</p>}
          {shown.map((e) => (
            <div key={e.id} className="flex items-center gap-3 border-t px-4 py-3 hover:bg-gray-50">
              <Building2 className="w-5 h-5 text-gray-400" />
              <button className="text-left flex-1" onClick={() => go(`#/emp/${e.id}`)}>
                <div className="font-medium text-blue-700 hover:underline">{e.nome}</div>
                <div className="text-xs text-gray-500">
                  {e.cliente ? `${e.cliente} · ` : ''}
                  {e.documentos} documento(s){e.status !== 'ativo' ? ' · concluído' : ''}
                </div>
              </button>
              {canEdit && (
                <button className="text-xs text-gray-500 hover:underline" onClick={() => run(() => api.updateProject(e.id, { status: e.status === 'ativo' ? 'concluido' : 'ativo' }))}>
                  {e.status === 'ativo' ? 'Marcar como concluído' : 'Reativar'}
                </button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      <Msg msg={msg} />
    </div>
  );
}

function UsersAdmin({ me }) {
  const [list, setList] = useState([]);
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', perfil: 'colaborador' });
  const [msg, setMsg] = useState(null);
  const load = useCallback(() => api.users().then(setList).catch((e) => setMsg(`Erro: ${e.message}`)), []);
  useEffect(() => {
    load();
  }, [load]);
  const run = async (fn, ok) => {
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await load();
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    }
  };
  const sel = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm';
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Novo usuário</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api.createUser(novo);
                setNovo({ nome: '', email: '', senha: '', perfil: 'colaborador' });
              }, 'Usuário criado. Passe o e-mail e a senha para a pessoa.');
            }}
          >
            <Field label="Nome" className="flex-1 min-w-[160px]">
              <Input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required />
            </Field>
            <Field label="E-mail" className="flex-1 min-w-[180px]">
              <Input type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} required />
            </Field>
            <Field label="Senha inicial">
              <Input className="w-36" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} required minLength={6} />
            </Field>
            <Field label="Perfil">
              <select className={sel} value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}>
                {Object.entries(PERFIL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Button>
              <Plus className="w-4 h-4 mr-1" /> Criar
            </Button>
          </form>
          <p className="mt-2 text-xs text-gray-500">Coordenação e administrador publicam, arquivam e criam empreendimentos. Colaboradores criam documentos, enviam arquivos e compartilham.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Usuários ({list.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className={`border-t ${u.ativo ? '' : 'text-gray-400'}`}>
                  <td className="p-2 pl-4">{u.name}</td>
                  <td className="p-2">{u.email}</td>
                  <td className="p-2">
                    <select className={sel + ' h-8'} value={u.perfil} onChange={(e) => run(() => api.updateUser(u.id, { perfil: e.target.value }), 'Perfil alterado.')}>
                      {Object.entries(PERFIL).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 text-right pr-4 whitespace-nowrap text-xs">
                    <button
                      className="text-blue-600 hover:underline mr-3"
                      onClick={() => {
                        const s = window.prompt(`Nova senha para ${u.name} (mínimo 6 caracteres):`);
                        if (s) run(() => api.updateUser(u.id, { senha: s }), 'Senha alterada.');
                      }}
                    >
                      Trocar senha
                    </button>
                    {u.id !== me.id && (
                      <button className="text-gray-600 hover:underline" onClick={() => run(() => api.updateUser(u.id, { ativo: !u.ativo }))}>
                        {u.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
      <Msg msg={msg} />
    </div>
  );
}

function PasswordForm() {
  const [f, setF] = useState({ atual: '', nova: '' });
  const [msg, setMsg] = useState(null);
  return (
    <Card className="max-w-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Trocar minha senha</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await api.changePassword(f.atual, f.nova);
              setF({ atual: '', nova: '' });
              setMsg('Senha alterada.');
            } catch (err) {
              setMsg(`Erro: ${err.message}`);
            }
          }}
        >
          <Field label="Senha atual">
            <Input type="password" value={f.atual} onChange={(e) => setF({ ...f, atual: e.target.value })} required />
          </Field>
          <Field label="Nova senha">
            <Input type="password" value={f.nova} onChange={(e) => setF({ ...f, nova: e.target.value })} required minLength={6} />
          </Field>
          <Button>Salvar</Button>
          <Msg msg={msg} />
        </form>
      </CardContent>
    </Card>
  );
}

function ProjectPage({ id }) {
  const [emp, setEmp] = useState(null);
  useEffect(() => {
    api
      .projects()
      .then((l) => setEmp(l.find((e) => String(e.id) === String(id)) || { id: Number(id), nome: `Empreendimento ${id}` }))
      .catch(() => setEmp({ id: Number(id), nome: `Empreendimento ${id}` }));
  }, [id]);
  if (!emp) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => go('#/')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Empreendimentos
        </Button>
        <h1 className="text-xl font-semibold">{emp.nome}</h1>
        {emp.cliente && <span className="text-sm text-gray-500">· {emp.cliente}</span>}
      </div>
      <CdeView empreendimento={emp} />
    </div>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);
  const [session, setSession] = useState(loadSession());
  const [error, setError] = useState(null);
  const hash = useHash();

  useEffect(() => {
    api.status().then(setStatus).catch((e) => setError(e.message));
    setOnExpired(() => {
      saveSession(null);
      setSession(null);
    });
  }, []);

  if (error) return <Centered title="CDE indisponível">{error}</Centered>;
  if (!status) return null;
  if (!status.configurado)
    return (
      <Setup
        onDone={(s) => {
          setSession(s);
          api.status().then(setStatus);
        }}
      />
    );
  if (!session) return <Login status={status} onDone={setSession} />;

  const user = session.user;
  const emp = /^#\/emp\/(\d+)/.exec(hash)?.[1];
  const page = emp ? <ProjectPage id={emp} /> : hash.startsWith('#/usuarios') && user.perfil === 'admin' ? <UsersAdmin me={user} /> : hash.startsWith('#/senha') ? <PasswordForm /> : <Projects user={user} />;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          <button className="font-semibold" onClick={() => go('#/')}>
            {status.nome} <span className="text-gray-400 font-normal">· CDE</span>
          </button>
          <nav className="flex items-center gap-1 text-sm">
            <Button variant="ghost" size="sm" onClick={() => go('#/')}>
              <Building2 className="w-4 h-4 mr-1" /> Empreendimentos
            </Button>
            {user.perfil === 'admin' && (
              <Button variant="ghost" size="sm" onClick={() => go('#/usuarios')}>
                <Users className="w-4 h-4 mr-1" /> Usuários
              </Button>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm text-gray-600">
            <span>
              {user.name} <span className="text-gray-400">({PERFIL[user.perfil] || user.perfil})</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => go('#/senha')} title="Trocar senha">
              <KeyRound className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              title="Sair"
              onClick={() => {
                saveSession(null);
                setSession(null);
              }}
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-4">{page}</main>
    </div>
  );
}
