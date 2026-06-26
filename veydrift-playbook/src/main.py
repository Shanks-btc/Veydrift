from getagent import runtime

if runtime.is_historical():
    from . import main_backtest
    main_backtest.run()
elif runtime.is_live():
    from . import main_live
    main_live.run()
else:
    raise ValueError(f"unsupported evaluation_mode={runtime.evaluation_mode!r}")
