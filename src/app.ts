import {VNode, div, label, input, hr, h1, button, makeDOMDriver, p as Para, select, option, ul as UL, li as LI, span} from '@cycle/dom';
import {DOMSource} from '@cycle/dom/xstream-typings'
import xs, {Stream, MemoryStream} from 'xstream'
import sampleCombine from 'xstream/extra/sampleCombine'

export type Sources = {
  DOM: DOMSource
}

export type Sinks = {
  DOM: Stream<VNode>
}

/* ****** ****** */
// simple view/presenter: text box + computation that depends on it

type Presenter = {
  nametext: (name$:Stream<string>) => Stream<string>
}

// to construct a view, have to supply a presenter, that specifies
// how certain processing is to be carried out
function view (dom: DOMSource, presenter: Presenter): Stream<VNode> {
  let name$ = dom.select('.field').events('input')
      .map(ev => (ev.target as HTMLInputElement).value)
      .startWith('')
  let value$ = presenter.nametext(name$)
  
  let vtree$ = xs.combine(name$, value$).map(([name, value]) =>
      div('#root', [
        h1('Greetings'),

        label('Name:'),
        input('.field', {attributes: {type: 'text', value: name}}),

        Para(value),
      ])
    )

  return vtree$
}

let presenter = {
  nametext: function(e: Stream<string>): Stream<string> {
    return e.map(name => name?`Hello, ${name}!`:'Hello! Please enter your name...');
  }
}

/* ****** ****** */
// counter

enum CounterCmd { Inc, Dec }

type PresenterCounter = {
  currentCount: (cmd$:Stream<CounterCmd>) => Stream<number>
}

function viewCounter (dom: DOMSource, presenter: PresenterCounter): Stream<VNode> {
  let action$ = xs.merge(
    dom.select('.decrement').events('click').map(ev => CounterCmd.Dec),
    dom.select('.increment').events('click').map(ev => CounterCmd.Inc)
  );
  let count$ = presenter.currentCount(action$).map(num => num.toLocaleString());
  let vtree$ =
    count$.map(count =>
        div([
          h1('Counter example (no pun intended)'),
          button('.decrement', 'Decrement'),
          button('.increment', 'Increment'),
          Para('Counter: ' + count)
        ])
    )
  return vtree$
}

function
presenterCounter() {
  let init = 0
  return {
    currentCount: (cmd: Stream<CounterCmd>): Stream<number> => {
      let cnt$ = cmd.map(c => c == CounterCmd.Inc? +1 : -1).fold((x, y) => x + y, init)

      return cnt$
    }
  }
}

/* ****** ****** */
// List selection

type PresenterListSel = {
  selectedValues: (selectedIndex: Stream<number>) => {choices: Stream<string[]>, selected: Stream<string>}
}

function viewListSel (dom: DOMSource, presenter: PresenterListSel): Stream<VNode> {
  let action$ = xs.merge(
    dom.select('.select')
      .events('change')
      .map(ev => {
        let target = ev.target as HTMLSelectElement
        return target.selectedIndex
      })
      .startWith(-1)
  );
  let {choices:choices$,selected:selected$} = presenter.selectedValues(action$);
  let vtree$ =
    xs.combine(choices$, selected$).map(([choices, selected]) =>
        div([
          h1('List selection example'),
          select('.select', choices.map((v) => option(v))),
          // FIXME: it seems that [combine] will pass [undefined] for events that didn't happen
          // so we have to include some logic here
          Para('You selected: ' + (selected === undefined? 'Nothing' : selected))
        ])
    )
  return vtree$
}

function
presenterListSel() {
  // simple case: the list of choices is static, set only once
  let init = ['Audi', 'Volkswagen', 'Ford', 'Skoda']
  let init$ = xs.fromArray([init])
  return {
    selectedValues: (selected$: Stream<number>): {choices: Stream<string[]>, selected: Stream<string>} => {
      let sel$ = selected$.map(selected => selected < -1 || selected > init.length? 'Nothing' : init[selected]);

      return {choices: init$, selected: sel$};
    }
  }
}

/* ****** ****** */
// list of items
// - items can be added and removed dynamically

type ListCmd = {type: "add"} | {type: "remove"; item: number}

type PresenterList = {
  list: (cmd$:Stream<ListCmd>, mkItem: (lab: string) => Stream<VNode>) => Stream<{id: number, dom: Stream<VNode>}[]>
}

function viewList(dom: DOMSource, presenter: PresenterList): Stream<VNode> {
  const addButtons = div('.addButtons', [
    button('.add-btn', 'Add Item'),
    button('.remove-btn', 'Remove Item')
  ]);
  let cmd$ = <Stream<ListCmd>>xs.merge(
    dom.select('.add-btn').events('click').mapTo({type: 'add'}),
    dom.select('.list-item').events('click').map(e => ({
      type: 'remove',
      item: parseInt((e.target as HTMLElement).parentElement.dataset["index"])
    }))
  );

  let items$ = presenter.list(cmd$,
    // output something simple, for now
    // TODO: events raised from items? e.g. details?
    // - have to collect individual item events (these will signal IDs of items), at the list level
    (lab) => xs.of(Para(lab)).remember())

  return items$.map(items => {
    const itemVNodeStreamsByKey = items.map(item =>
      item.dom.map(vnode => {
        vnode.key = item.id; return vnode;
      })
    );
    return xs.combine(...itemVNodeStreamsByKey)
      .map(vnodes => {
        let LIs = vnodes.map(e =>
          div('.list-item', {attrs: {'data-index': e.key}}, [e]));
        return div('.list', [addButtons].concat(LIs))
      });
  }).flatten();
}

function
presenterList (): PresenterList {
  return {
    list: (cmd$ :Stream<ListCmd>, mkItem: (lab: string) => Stream<VNode>): Stream<{id: number, dom: Stream<VNode>}[]> => {
      let counter = 0 // mutable

      let onCreate$ = cmd$.filter(a => a.type === 'add').map(cmd => {
        return function(items: {id: number, dom: Stream<VNode>}[]): {id: number, dom: Stream<VNode>}[] {
          let id = counter
          counter++;

          // what if we just want ids to be based directly on underlying array indexes?
          // - why even bother with ids at view level???
          let newItem = {id: id, dom: mkItem(id.toString())}

          items.push(newItem);
          return items;
        }
      });

      let onRemove$ = cmd$.filter(a => a.type === 'remove').map(cmd => {
        return function(items: {id: number, dom: Stream<VNode>}[]) {
          if (cmd.type !== 'remove') throw "wrong cmd type";
          var idx = items.findIndex(p => p.id == cmd.item);
          if (idx !== -1) items.splice(idx, 1);
          return items;
        }
      });

      let init : {id: number, dom: Stream<VNode>}[] = []

      return xs.merge(onCreate$, onRemove$).fold((listItems, mutator) => mutator(listItems), init);
    }
  }
}

/* ****** ****** */
// chip-in calculator

type CmdType = { type: 'ADD'; payload: string; amount: number } | { type: 'REMOVE'; index: number } | { type: 'CALCULATE' }
type CmdTypeChipIn =  { type: 'TOGGLE'; index: number }
type Contrib = { text: string; amount: number }
type Payback = { from: string; to: string; amount: number; complete: boolean }
type ChipIn = { total: number; equalPayment: number }

function
calcContribTotals(contributors: Contrib[]): ChipIn {
  const totalValue = contributors.reduce((p,c) => p+c.amount, 0);
  const equalPayment = contributors.length? totalValue/contributors.length : 0;
  return { total: totalValue, equalPayment: equalPayment };
}

function
calcContribs(contributors: Contrib[]): Payback[] {
  const totalValue = contributors.reduce((p,c) => p+c.amount, 0);
  const equalPayment = totalValue/contributors.length;
  const tmpArr = contributors.map((d) => ({text: d.text, amount: equalPayment - d.amount}));

  const debtors = tmpArr.filter((e) => e.amount > 0);
  const lenders = tmpArr.filter((e) => e.amount < 0);

  var lender = lenders.length > 0? lenders[0] : null;
  var debtor = debtors.length > 0? debtors[0] : null;
  var values : Payback[] = [];

  while (lenders.length > 0 && debtors.length > 0) {
    lender = lender || lenders[0];
    debtor = debtor || debtors[0];
    let delta = debtor.amount + lender.amount;

    if (delta < 0) {
        values.push({
          from: debtor.text,
          to: lender.text,
          amount: debtor.amount,
          complete: false
        });
        lender.amount += debtor.amount;
        debtor.amount = 0;
    } else {
        values.push({
            from: debtor.text,
            to: lender.text,
            amount: -lender.amount,
            complete: false
        });
        debtor.amount += lender.amount;
        lender.amount = 0;
    }

    if (debtor.amount === 0) {
        debtors.splice(0, 1);
        debtor = null;
    }
    if (lender.amount === 0) {
        lenders.splice(0, 1);
        lender = null;
    }

    delta = 0;
  }

  return values;
}

function
contribsPresenter(action$: Stream<CmdType>, chipIn$: Stream<CmdTypeChipIn>): {contribs: Stream<Contrib[]>, aggregates: Stream<ChipIn>, paybacks: Stream<Payback[]>} {
  const addReducer$ = action$
    .filter(action => action.type === 'ADD')
    .map((action: { type: 'ADD'; payload: string; amount: number }) => (contribs: Contrib[]): Contrib[] => contribs.concat({
      text: action.payload,
      amount: action.amount
    }));
    
  const removeReducer$ = action$
    .filter(action => action.type === 'REMOVE')
    .map((action: {type: 'REMOVE'; index: number}) => (contribs: Contrib[]): Contrib[] => contribs.filter((todo, i) => i !== action.index));

  const calculateCmd$ = action$.filter(action => action.type === 'CALCULATE').debug('CALCULATING');

  const reducer$ = xs.merge(addReducer$, removeReducer$);
  const contribs$ = reducer$.fold((state, reducer) => reducer(state), [] as Contrib[]).debug('state');

  const aggregates$ = contribs$.map(st => calcContribTotals(st)).startWith({total: 0, equalPayment: 0});

  const calculateReducer$ =
    xs.combine(calculateCmd$, contribs$).map(([calculateCmd, contribs]) => (chipIn: Payback[]): Payback[] => calcContribs(contribs));
  const toggleReducer$ = chipIn$
    .map((action: {type: 'TOGGLE'; index: number}) => (values: Payback[]): Payback[] => (
      values.map((payment, i) => {
          console.log(payment, i, action.index);
          if (i === action.index) {
            return {
              ...payment,
              complete: !payment.complete
            }
          } else {
            return payment
          }
      })
    ));
  const reducerChipIn$ = xs.merge(calculateReducer$, toggleReducer$);
  const paybacks$ = reducerChipIn$.fold((state, reducer) => reducer(state), []).debug('state chip-ins');

  return {
    contribs: contribs$,
    aggregates: aggregates$,
    paybacks: paybacks$
  }
}

function
contribsView(
  sources: Sources,
  presenter: (e: Stream<CmdType>, u: Stream<CmdTypeChipIn>) => {contribs: Stream<Contrib[]>, aggregates: Stream<ChipIn>, paybacks: Stream<Payback[]>}
): Sinks {
  const name$ = sources.DOM
    .select('.add-name')
    .events('input')
    .map(e => (e.target as HTMLInputElement).value);
  const amount$ = sources.DOM.select('.add-amount')
      .events('input')
      .map(ev => parseFloat((ev.target as HTMLInputElement).value))
      .startWith(0.0);
  const addClicks$ = sources.DOM.select('.add')
    .events('click')
    .mapTo(true);
  // we only want values of name/amount when button is clicked
  const add$ = sampleCombine(name$,amount$)(addClicks$).map(([click, name, amount]) => ({
    type: 'ADD',
    payload: name,
    amount: amount
  }));
  const calculate$ = sources.DOM.select('.calc')
    .events('click')
    .mapTo({type: 'CALCULATE'});

  const toggle$ = sources.DOM
    .select('.chipIn')
    .events('click')
    .debug(e => console.log('toggling: ' + (e.target as HTMLElement).dataset["index"]))
    .map(e => {
      return {
        type: 'TOGGLE',
        index: parseInt((e.target as HTMLElement).dataset["index"])
      }
    });
    
  const remove$ = sources.DOM
    .select('.contrib>.remove')
    .events('click')
    .debug(e => console.log((e.target as HTMLElement).parentElement.dataset["index"]))
    .map(e => ({
      type: 'REMOVE',
      index: parseInt((e.target as HTMLElement).parentElement.dataset["index"])
    }));
    
  const intent$ = (xs.merge(add$, remove$, calculate$) as Stream<CmdType>);
  const state$ = presenter(intent$, toggle$ as Stream<CmdTypeChipIn>);

  return {
    DOM: xs.combine(state$.contribs, state$.aggregates, state$.paybacks).map(([contribs, aggregates, paybacks]) => div([
      h1('Chip-in calculator'),

      input('.add-name', {attrs: {placeholder: 'Name'}}),
      input('.add-amount', {attrs: {type: 'number', placeholder: 'Amount'}}),
      button('.add', 'Add'),

      ...contribs.map((contrib, i) => div('.contrib', {
        attrs: {'data-index': i}
      }, [
        span('.text', contrib.text),
        ' ',
        span('.amount', contrib.amount.toString()),
        ' ',
        button('.remove', 'Remove')
      ])),

      button('.calc', 'Calculate'),

      // TODO: show results modally?

      Para(['Total amount: ', span('.amount', aggregates.total)]),
      Para(['Equal payment: ', span('.amount', aggregates.equalPayment)]),

      ...(paybacks).map((payback, i) => div('.chipIn', {
        attrs: {'data-index': i},
        style: {'text-decoration': payback.complete? 'line-through': 'none'}
      }, [
        payback.from,
        ' should give ', payback.amount.toString(),
        ' to ', payback.to
      ]))
    ]))
  };
}

/* ****** ****** */
// elapsed timer

type ElapsedTimerCmd = {type: 'START'} | {type: 'STOP'} | {type: 'RESET'}

class Timer {
  readonly _running : boolean;
  readonly _timer : number;
  constructor(running: boolean, timer: number) {
    this._running = running;
    this._timer = timer;
  }
  public static init(): Timer {
    return new Timer(false, 0);
  }
  public switch() {
    return new Timer(!this._running, this._timer);
  }
  public reset() {
    return Timer.init();
  }
  public inc() {
    return new Timer(this._running, this._running? this._timer + 1 : this._timer);
  }
  get running(): boolean {
    return this._running;
  }
  get timer(): number {
    return this._timer;
  }
}

type PresenterState = {running: boolean; timer: number}

function
viewElapsedTimer (dom: DOMSource, presenter: (e: Stream<ElapsedTimerCmd>) => Stream<{running: boolean; mins: number, secs: number}>): Stream<VNode> {
  const strm$ = dom.select('.timer-startstop')
    .events('click')
    .map((e) => {
      let running = !!((e.target as HTMLElement).dataset["running"]); // convert to boolean; sheesh!
      return {type: running? 'START' : 'STOP' };
    });
  const reset$ = dom.select('.timer-reset').events('click').mapTo({type: 'RESET'});
  const cmd$ = xs.merge(strm$, reset$) as Stream<ElapsedTimerCmd>;

  const vstate$ = presenter(cmd$)

  let padToTwo = (n:number): string => n <= 9999 ? ("00"+n.toString()).slice(-2) : n.toString();

  return vstate$.map((vs) => div('.elapsed-timer', [
    h1('Elapsed timer'),
    button('.timer-startstop', {attrs: {'data-running': vs.running.toString()}}, vs.running? 'Stop' : 'Start'),
    button('.timer-reset', 'Reset'),
    Para(`${padToTwo(vs.mins)}:${padToTwo(vs.secs)}`)
  ]));
}

function timerInit (): PresenterState {
  return { running: false, timer: 0 }
}
function
timerSwitch(e: PresenterState): PresenterState {
  return {
    running: !e.running,
    timer: e.timer
  };
}
function
timerReset (e: PresenterState): PresenterState {
  return {
    running: false,
    timer: 0
  };
}
function
timerInc (e: PresenterState): PresenterState {
  return {
    running: e.running,
    timer: e.running? e.timer+1 : e.timer
  };
}

function
presenterElapsedTimer (cmd$: Stream<ElapsedTimerCmd>): Stream<{running: boolean; secs: number; mins: number}> {
  let running$ =
    cmd$.map(t => (e: PresenterState): PresenterState => {
      switch (t.type) {
        case 'START': return timerSwitch(e);
        case 'STOP': return timerSwitch(e);
        case 'RESET': return timerReset(e);
      }
    });

  let timer$ =
    xs.periodic(1000).map(t => timerInc);

  const init = timerInit ()
  const state$ =
    xs.merge(running$, timer$)
      .fold((state, reducer) => reducer(state), init)
      .startWith(init);

  let secs$ = state$.map(state => {
      let seconds = ~~(state.timer % 60);
      let minutes = ~~(state.timer / 60);
      return { running: state.running, mins: minutes, secs: seconds };
    });

  return secs$;
}

/* ****** ****** */
// main routine

export function App (sources: Sources): Sinks {

  let greeting$ = view(sources.DOM, presenter)
  let counter$ = viewCounter(sources.DOM, presenterCounter())
  let listSel$ = viewListSel(sources.DOM, presenterListSel())
  let listItems$ = viewList(sources.DOM, presenterList())
  let contribs$ = contribsView(sources, contribsPresenter)
  let timer$ = viewElapsedTimer(sources.DOM, presenterElapsedTimer)

  const sinks = {
    DOM:
      xs.combine(greeting$, counter$, listSel$, listItems$, contribs$.DOM, timer$)
        .map(([greeting, counter, listSel, listItems, contribs, timer]) =>
        div ([greeting, hr(), counter, hr(), listSel, hr(), listItems, hr(), contribs, hr(), timer]))
  }

  return sinks
}
