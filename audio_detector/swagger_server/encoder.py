from json import JSONEncoder
import decimal
from datetime import datetime, date

# Keep a datetime.date in ‘yyyy-mm-dd’ format when using Flask’s jsonify
class CustomJSONEncoder(JSONEncoder):
    def default(self, obj):
        '''Keep a datetime.date in ‘yyyy-mm-dd’ format when using Flask’s jsonify'''
        try:
            if isinstance(obj, date):
                return obj.isoformat()
            elif isinstance(obj, decimal.Decimal):
                return float(obj)
            iterable = iter(obj)
        except TypeError:
            pass
        else:
            return list(iterable)
        return JSONEncoder.default(self, obj)
